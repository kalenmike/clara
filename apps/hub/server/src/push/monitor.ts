import type { ClaraEvent, ClaraProject, ClaraSession } from '@clara/api-contract'
import type { AttentionKind } from '@clara/shared-types'
import type { HarnessManager } from '../harness/manager.ts'
import { isArchivedSession, isSnoozedSession, loadSessionAttention } from './attention.ts'
import { getSession, listProjects, openEventStream } from './harness.ts'
import { buildPushPayload } from './payload.ts'
import type { PushService } from './service.ts'
import { parseSse } from './sse.ts'

const EVALUATE_DELAY_MS = 750
const ALERT_COOLDOWN_MS = 5_000
const PROJECT_CACHE_MS = 60_000
const STALL_MS = 45_000
const WATCHDOG_MS = 5_000
const MAX_BACKOFF_MS = 30_000

export type PushMonitorOptions = {
  harness: HarnessManager
  push: PushService
  /** True while a desktop client is visible and recently used. */
  isDeskActive?: () => boolean
  /** True when this session should not produce a generic session alert. */
  suppressSession?: (session: ClaraSession) => boolean
  log?: (message: string, detail?: unknown) => void
}

/**
 * Watches the harness while no Clara client is guaranteed to be connected. The
 * browser does its own notification work when it is open; this monitor exists
 * for the closed-app and suspended-tab cases.
 */
export class PushMonitor {
  private readonly harness: HarnessManager
  private readonly push: PushService
  private readonly isDeskActive?: () => boolean
  private readonly suppressSession?: (session: ClaraSession) => boolean
  private readonly log?: (message: string, detail?: unknown) => void
  private readonly timers = new Map<string, NodeJS.Timeout>()
  private readonly interrupted = new Set<string>()
  private readonly lastAlert = new Map<string, { kind: AttentionKind; at: number }>()
  private projectsCache: { at: number; projects: ClaraProject[] } | undefined
  private controller: AbortController | null = null
  private stopped = true

  constructor(options: PushMonitorOptions) {
    this.harness = options.harness
    this.push = options.push
    this.isDeskActive = options.isDeskActive
    this.suppressSession = options.suppressSession
    this.log = options.log
  }

  start(): void {
    if (!this.stopped) return
    this.stopped = false
    void this.run()
  }

  close(): void {
    this.stopped = true
    this.controller?.abort()
    this.controller = null
    for (const timer of this.timers.values()) clearTimeout(timer)
    this.timers.clear()
    this.interrupted.clear()
  }

  private async run(): Promise<void> {
    let retry = 0

    while (!this.stopped) {
      const controller = new AbortController()
      this.controller = controller
      let lastActivity = Date.now()
      const watchdog = setInterval(() => {
        if (Date.now() - lastActivity > STALL_MS) controller.abort()
      }, WATCHDOG_MS)
      watchdog.unref()

      try {
        const stream = await openEventStream(this.harness, controller.signal)
        retry = 0
        this.log?.('push event monitor connected')

        for await (const event of parseSse(stream, () => {
          lastActivity = Date.now()
        })) {
          lastActivity = Date.now()
          this.handleEvent(event as ClaraEvent)
        }
      } catch (cause) {
        if (!this.stopped) this.log?.('push event monitor disconnected', cause)
      } finally {
        clearInterval(watchdog)
        if (this.controller === controller) this.controller = null
      }

      if (this.stopped) break
      retry += 1
      await sleep(backoff(retry))
    }
  }

  private handleEvent(event: ClaraEvent): void {
    switch (event.type) {
      case 'permission.asked':
        void this.notify('question', event.data.sessionID, event.data.message ?? event.data.action)
        return

      case 'form.created':
        void this.notify('question', event.data.form.sessionID, event.data.form.title)
        return

      case 'session.execution.failed':
        void this.notify('error', event.data.sessionID, event.data.error.message)
        return

      case 'session.execution.interrupted':
        this.interrupted.add(event.data.sessionID)
        return

      case 'session.execution.started': {
        this.interrupted.delete(event.data.sessionID)
        const pending = this.timers.get(event.data.sessionID)
        if (pending) clearTimeout(pending)
        this.timers.delete(event.data.sessionID)
        return
      }

      case 'session.execution.succeeded':
      case 'session.idle':
        this.scheduleEvaluation(event.data.sessionID)
        return
    }
  }

  private scheduleEvaluation(sessionID: string): void {
    const existing = this.timers.get(sessionID)
    if (existing) clearTimeout(existing)

    const timer = setTimeout(() => {
      this.timers.delete(sessionID)
      void this.evaluate(sessionID)
    }, EVALUATE_DELAY_MS)
    timer.unref()
    this.timers.set(sessionID, timer)
  }

  private async evaluate(sessionID: string): Promise<void> {
    if (this.stopped || this.push.count === 0) return
    if (this.interrupted.delete(sessionID)) return

    try {
      const attention = await loadSessionAttention(this.harness, sessionID)
      if (!attention || this.stopped) return
      await this.notify(
        attention.kind,
        sessionID,
        undefined,
        this.overlaySession(attention.session)
      )
    } catch (cause) {
      this.log?.('push attention check failed', cause)
    }
  }

  private async notify(
    kind: AttentionKind,
    sessionID: string,
    detail?: string,
    knownSession?: ClaraSession
  ): Promise<void> {
    if (this.stopped || this.push.count === 0) return
    if (!this.claimAlert(sessionID, kind)) return

    try {
      const loaded = knownSession ?? (await getSession(this.harness, sessionID))
      const session = loaded ? this.overlaySession(loaded) : null
      if (!session || isArchivedSession(session) || isSnoozedSession(session)) return
      if (this.suppressSession?.(session)) return

      const url = await this.resolveSessionUrl(session)
      await this.push.notify(
        buildPushPayload({
          kind,
          sessionID,
          sessionTitle: session.title,
          detail,
          url,
        }),
        { skipMobile: this.isDeskActive?.() === true }
      )
    } catch (cause) {
      this.log?.('push notification failed', cause)
    }
  }

  private claimAlert(sessionID: string, kind: AttentionKind): boolean {
    const now = Date.now()
    const previous = this.lastAlert.get(sessionID)
    if (previous && previous.kind === kind && now - previous.at < ALERT_COOLDOWN_MS) {
      return false
    }
    this.lastAlert.set(sessionID, { kind, at: now })

    if (this.lastAlert.size > 500) {
      for (const [id, alert] of this.lastAlert) {
        if (now - alert.at > 60_000) this.lastAlert.delete(id)
      }
    }
    return true
  }

  private async resolveSessionUrl(session: ClaraSession): Promise<string> {
    const route = (projectID: string) =>
      `/p/${encodeURIComponent(projectID)}/s/${encodeURIComponent(session.id)}`

    if (session.projectID && session.projectID !== 'global') return route(session.projectID)

    const projects = await this.projects()
    const project =
      projects.find((item) => item.id === session.projectID) ??
      projects.find((item) => item.canonical === session.location.directory)
    return project ? route(project.id) : '/'
  }

  private overlaySession(session: ClaraSession): ClaraSession {
    const harnessId = this.harness.active?.harnessId
    return harnessId ? this.harness.overlaySession(harnessId, session) : session
  }

  private async projects(): Promise<ClaraProject[]> {
    const now = Date.now()
    if (this.projectsCache && now - this.projectsCache.at < PROJECT_CACHE_MS) {
      return this.projectsCache.projects
    }
    const harnessId = this.harness.active?.harnessId
    const projects = (await listProjects(this.harness)).map((project) =>
      harnessId ? this.harness.overlayProject(harnessId, project) : project
    )
    this.projectsCache = { at: now, projects }
    return projects
  }
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
