import type { ClaraEvent, ClaraSession } from '@clara/api-contract'
import type { AttentionKind } from '@clara/shared-types'
import type { HarnessManager } from '../harness/manager.ts'
import type { HarnessRequest } from '../harness/types.ts'
import { isArchivedSession, isSnoozedSession, loadSessionAttention } from './attention.ts'
import { getSession, openEventStream } from './harness.ts'
import { buildPushPayload } from './payload.ts'
import type { PushService } from './service.ts'
import { parseSse } from './sse.ts'

const EVALUATE_DELAY_MS = 750
const ALERT_COOLDOWN_MS = 5_000
const STALL_MS = 45_000
const WATCHDOG_MS = 5_000
const MAX_BACKOFF_MS = 30_000

type HarnessStream = {
  harnessID: string
  client: HarnessRequest
  controller: AbortController | null
}

export type PushMonitorOptions = {
  harness: HarnessManager
  push: PushService
  /** True while a desktop client is visible and recently used. */
  isDeskActive?: () => boolean
  /** True when worker alerts should skip devices that use orchestrator mode. */
  suppressForOrchestratorClients?: (session: ClaraSession) => boolean
  log?: (message: string, detail?: unknown) => void
}

/**
 * Watches every online harness while no Clara client is guaranteed to be
 * connected. The browser does its own notification work when it is open; this
 * monitor exists for the closed-app and suspended-tab cases.
 */
export class PushMonitor {
  private readonly harness: HarnessManager
  private readonly push: PushService
  private readonly isDeskActive?: () => boolean
  private readonly suppressForOrchestratorClients?: (session: ClaraSession) => boolean
  private readonly log?: (message: string, detail?: unknown) => void
  private readonly timers = new Map<string, NodeJS.Timeout>()
  private readonly interrupted = new Set<string>()
  private readonly lastAlert = new Map<string, { kind: AttentionKind; at: number }>()
  private readonly streams = new Map<string, HarnessStream>()
  private stopped = true

  constructor(options: PushMonitorOptions) {
    this.harness = options.harness
    this.push = options.push
    this.isDeskActive = options.isDeskActive
    this.suppressForOrchestratorClients = options.suppressForOrchestratorClients
    this.log = options.log
  }

  start(): void {
    this.stopped = false
    this.sync()
  }

  close(): void {
    this.stopped = true
    for (const stream of this.streams.values()) stream.controller?.abort()
    this.streams.clear()
    for (const timer of this.timers.values()) clearTimeout(timer)
    this.timers.clear()
    this.interrupted.clear()
    this.lastAlert.clear()
  }

  /**
   * Reconcile the supervised streams with the harnesses that are online right
   * now. Pairing, forgetting, or an adapter reconnect only touches the stream
   * for the harness that changed.
   */
  sync(): void {
    if (this.stopped) return

    const online = new Set(
      this.harness
        .list()
        .filter((connection) => connection.online)
        .map((connection) => connection.harnessId)
    )

    for (const [harnessID, stream] of this.streams) {
      if (online.has(harnessID)) continue
      this.streams.delete(harnessID)
      stream.controller?.abort()
      this.clearHarnessState(harnessID)
    }

    for (const harnessID of online) {
      if (this.streams.has(harnessID)) continue
      const client: HarnessRequest = {
        request: (input, signal) => this.harness.requestFor(harnessID, input, signal),
      }
      const stream: HarnessStream = { harnessID, client, controller: null }
      this.streams.set(harnessID, stream)
      void this.run(stream)
    }
  }

  private async run(stream: HarnessStream): Promise<void> {
    let retry = 0
    const current = () => this.streams.get(stream.harnessID) === stream

    while (!this.stopped && current()) {
      const controller = new AbortController()
      stream.controller = controller
      let lastActivity = Date.now()
      const watchdog = setInterval(() => {
        if (Date.now() - lastActivity > STALL_MS) controller.abort()
      }, WATCHDOG_MS)
      watchdog.unref()

      try {
        const body = await openEventStream(stream.client, controller.signal)
        retry = 0
        this.log?.(`push event monitor connected (${stream.harnessID})`)

        for await (const event of parseSse(body, () => {
          lastActivity = Date.now()
        })) {
          lastActivity = Date.now()
          this.handleEvent(stream.harnessID, event as ClaraEvent)
        }
      } catch (cause) {
        if (!this.stopped && current()) {
          this.log?.(`push event monitor disconnected (${stream.harnessID})`, cause)
        }
      } finally {
        clearInterval(watchdog)
        if (stream.controller === controller) stream.controller = null
      }

      if (this.stopped || !current()) break
      retry += 1
      await sleep(backoff(retry))
    }
  }

  private handleEvent(harnessID: string, event: ClaraEvent): void {
    switch (event.type) {
      case 'permission.asked':
        void this.notify(
          harnessID,
          'question',
          event.data.sessionID,
          event.data.message ?? event.data.action
        )
        return

      case 'form.created':
        void this.notify(harnessID, 'question', event.data.form.sessionID, event.data.form.title)
        return

      case 'session.execution.failed':
        void this.notify(harnessID, 'error', event.data.sessionID, event.data.error.message)
        return

      case 'session.execution.interrupted':
        this.interrupted.add(alertKey(harnessID, event.data.sessionID))
        return

      case 'session.execution.started': {
        const key = alertKey(harnessID, event.data.sessionID)
        this.interrupted.delete(key)
        const pending = this.timers.get(key)
        if (pending) clearTimeout(pending)
        this.timers.delete(key)
        return
      }

      case 'session.execution.succeeded':
      case 'session.idle':
        this.scheduleEvaluation(harnessID, event.data.sessionID)
        return
    }
  }

  private scheduleEvaluation(harnessID: string, sessionID: string): void {
    const key = alertKey(harnessID, sessionID)
    const existing = this.timers.get(key)
    if (existing) clearTimeout(existing)

    const timer = setTimeout(() => {
      this.timers.delete(key)
      void this.evaluate(harnessID, sessionID)
    }, EVALUATE_DELAY_MS)
    timer.unref()
    this.timers.set(key, timer)
  }

  private async evaluate(harnessID: string, sessionID: string): Promise<void> {
    if (this.stopped || this.push.count === 0) return
    if (this.interrupted.delete(alertKey(harnessID, sessionID))) return

    const stream = this.streams.get(harnessID)
    if (!stream) return

    try {
      const attention = await loadSessionAttention(stream.client, sessionID)
      if (!attention || this.stopped) return
      await this.notify(harnessID, attention.kind, sessionID, undefined, attention.session)
    } catch (cause) {
      this.log?.('push attention check failed', cause)
    }
  }

  private async notify(
    harnessID: string,
    kind: AttentionKind,
    sessionID: string,
    detail?: string,
    knownSession?: ClaraSession
  ): Promise<void> {
    if (this.stopped || this.push.count === 0) return
    if (!this.claimAlert(harnessID, sessionID, kind)) return

    const stream = this.streams.get(harnessID)
    if (!stream) return

    try {
      const loaded = knownSession ?? (await getSession(stream.client, sessionID))
      const session = loaded ? this.overlaySession(harnessID, loaded) : null
      if (!session || isArchivedSession(session) || isSnoozedSession(session)) return

      const url = this.resolveSessionUrl(harnessID, session)
      await this.push.notify(
        buildPushPayload({
          kind,
          sessionID,
          sessionTitle: session.title,
          detail,
          url,
        }),
        {
          skipMobile: this.isDeskActive?.() === true,
          skipOrchestratorClients: this.suppressForOrchestratorClients?.(session) === true,
        }
      )
    } catch (cause) {
      this.log?.('push notification failed', cause)
    }
  }

  private claimAlert(harnessID: string, sessionID: string, kind: AttentionKind): boolean {
    const now = Date.now()
    const key = alertKey(harnessID, sessionID)
    const previous = this.lastAlert.get(key)
    if (previous && previous.kind === kind && now - previous.at < ALERT_COOLDOWN_MS) {
      return false
    }
    this.lastAlert.set(key, { kind, at: now })

    if (this.lastAlert.size > 500) {
      for (const [id, alert] of this.lastAlert) {
        if (now - alert.at > 60_000) this.lastAlert.delete(id)
      }
    }
    return true
  }

  private resolveSessionUrl(harnessID: string, session: ClaraSession): string {
    const route = (projectID: string) =>
      `/p/${encodeURIComponent(projectID)}/s/${encodeURIComponent(session.id)}`
    const projects = this.harness.projects

    if (session.projectID && session.projectID !== 'global') {
      const linked = projects.projectForHarnessProject(harnessID, session.projectID)
      return route(linked?.id ?? session.projectID)
    }

    const directory = session.location.directory
    const workspace = projects
      .workspacesForDirectory(directory)
      .find((item) => item.harnessID === harnessID)
    return workspace ? route(workspace.projectID) : '/'
  }

  private overlaySession(harnessID: string, session: ClaraSession): ClaraSession {
    return this.harness.overlaySession(harnessID, session)
  }

  private clearHarnessState(harnessID: string): void {
    const prefix = `${harnessID}:`
    for (const [key, timer] of this.timers) {
      if (!key.startsWith(prefix)) continue
      clearTimeout(timer)
      this.timers.delete(key)
    }
    for (const key of this.interrupted) {
      if (key.startsWith(prefix)) this.interrupted.delete(key)
    }
    for (const key of this.lastAlert.keys()) {
      if (key.startsWith(prefix)) this.lastAlert.delete(key)
    }
  }
}

function alertKey(harnessID: string, sessionID: string): string {
  return `${harnessID}:${sessionID}`
}

function backoff(attempt: number): number {
  const base = Math.min(1_000 * 2 ** Math.min(attempt, 5), MAX_BACKOFF_MS)
  return Math.round(base * (0.8 + Math.random() * 0.4))
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    timer.unref()
  })
}
