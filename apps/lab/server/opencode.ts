import { OpenCode } from '@opencode/client'
import type { OpenCodeEvent, SessionInfo } from '@opencode/client'
import { basicAuth, type OpenCodeConfig } from './models.ts'
import type { OpenCodeSessionRow, OpenCodeSessionsResult, OpenCodeSummary } from './types.ts'

const REQUEST_TIMEOUT_MS = 4_000
const MAX_SESSIONS = 100
const RETRY_MS = 5_000

interface SessionActivity {
  firstSeenAt: string
  lastSeenAt?: string
  lastEventType?: string
  eventCount: number
}

export interface OpenCodeErrorExplanation {
  kind: 'auth' | 'connection' | 'unknown'
  hint: string
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function eventTime(event: OpenCodeEvent, fallback: string): string {
  const record = event as unknown
  const created = isRecord(record) ? record.created : undefined
  if (typeof created !== 'number' || !Number.isFinite(created)) return fallback
  return new Date(created).toISOString()
}

function eventSessionID(event: OpenCodeEvent): string | undefined {
  const record = event as unknown
  if (!isRecord(record) || !isRecord(record.data)) return undefined
  return stringValue(record.data.sessionID)
}

function sessionLastSeen(info: SessionInfo): string | undefined {
  const updated = info.time?.updated
  if (typeof updated !== 'number' || !Number.isFinite(updated)) return undefined
  return new Date(updated).toISOString()
}

function modelLabel(info: SessionInfo): string | undefined {
  if (!info.model) return undefined
  return `${info.model.providerID}/${info.model.id}`
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function explainOpenCodeError(
  error: string,
  config: { url: string; serviceFile: string; password?: string }
): OpenCodeErrorExplanation {
  const text = error.toLowerCase()
  if (
    text.includes('authentication required') ||
    text.includes('unauthorized') ||
    /\b40[13]\b/.test(text)
  ) {
    const opening = config.password
      ? 'OpenCode rejected the password Clara Lab found.'
      : 'Clara Lab did not find a password for OpenCode.'
    return {
      kind: 'auth',
      hint: [
        opening,
        'Run pnpm clara pass to check the local service password, then either:',
        '- set CLARA_OPENCODE_PASSWORD before starting the lab, or',
        `- make sure ${config.serviceFile} contains both "url" and "password".`,
        'After changing either one, press Reconnect OpenCode.',
      ].join('\n'),
    }
  }
  if (
    text.includes('econnrefused') ||
    text.includes('enotfound') ||
    text.includes('fetch failed') ||
    text.includes('network') ||
    text.includes('timed out') ||
    text.includes('timeout') ||
    text.includes('aborted')
  ) {
    return {
      kind: 'connection',
      hint: `Clara Lab could not reach OpenCode at ${config.url}. Start OpenCode, or set CLARA_OPENCODE_URL to the reachable address, then press Reconnect OpenCode.`,
    }
  }
  return {
    kind: 'unknown',
    hint: `Clara Lab could not read OpenCode at ${config.url}. Check the OpenCode server output, then press Reconnect OpenCode.`,
  }
}

/**
 * Tracks live OpenCode sessions without exposing the OpenCode password to the
 * browser. The event stream gives us last-seen activity; the session list seeds
 * idle sessions and their metadata so rogue sessions still show up.
 */
export class OpenCodeObserver {
  private readonly configSource: () => OpenCodeConfig
  private readonly onChange: (summary: OpenCodeSummary) => void
  private readonly activity = new Map<string, SessionActivity>()
  private readonly details = new Map<string, SessionInfo>()
  private readonly running = new Set<string>()
  private readonly enriching = new Set<string>()
  private config: OpenCodeConfig
  private client: ReturnType<typeof OpenCode.make>
  private controller: AbortController | undefined
  private loopPromise: Promise<void> | undefined
  private stopped = false
  private refreshing: Promise<void> | undefined
  private connected = false
  private reachable = false
  private error: string | undefined
  private errorKind: OpenCodeSummary['errorKind']
  private hint: string | undefined
  private updatedAt = new Date().toISOString()

  constructor(configSource: () => OpenCodeConfig, onChange: (summary: OpenCodeSummary) => void) {
    this.configSource = configSource
    this.onChange = onChange
    this.config = configSource()
    this.client = this.makeClient(this.config)
  }

  start(): void {
    if (this.loopPromise) return
    this.stopped = false
    this.refreshConfig()
    this.loopPromise = this.loop()
    void this.refresh()
  }

  async stop(): Promise<void> {
    this.stopped = true
    this.controller?.abort()
    await this.loopPromise?.catch(() => {})
    this.loopPromise = undefined
    this.connected = false
    this.publish()
  }

  async reconnect(): Promise<void> {
    this.stopped = true
    this.controller?.abort()
    await this.loopPromise?.catch(() => {})
    this.loopPromise = undefined
    this.stopped = false
    this.connected = false
    this.reachable = false
    this.clearError()
    this.refreshConfig()
    this.publish()
    this.loopPromise = this.loop()
    void this.refresh()
  }

  summary(): OpenCodeSummary {
    const ids = new Set([...this.details.keys(), ...this.activity.keys()])
    return {
      connected: this.connected,
      reachable: this.reachable,
      url: this.config.url,
      sessionCount: ids.size,
      activeCount: this.running.size,
      auth: {
        present: Boolean(this.config.password),
        source: this.config.source,
        serviceFile: this.config.serviceFile,
      },
      updatedAt: this.updatedAt,
      ...(this.error ? { error: this.error } : {}),
      ...(this.errorKind ? { errorKind: this.errorKind } : {}),
      ...(this.hint ? { hint: this.hint } : {}),
    }
  }

  async sessions(): Promise<OpenCodeSessionsResult> {
    await this.refresh()
    const ids = new Set([...this.details.keys(), ...this.activity.keys()])
    const rows: OpenCodeSessionRow[] = []
    for (const id of ids) {
      const detail = this.details.get(id)
      const activity = this.activity.get(id)
      const lastEvent = activity?.lastSeenAt
      const lastSession = detail ? sessionLastSeen(detail) : undefined
      const lastSeenAt =
        lastEvent && lastSession
          ? lastEvent > lastSession
            ? lastEvent
            : lastSession
          : (lastEvent ?? lastSession ?? new Date(0).toISOString())
      rows.push({
        id,
        ...(detail?.title ? { title: detail.title } : {}),
        ...(detail?.agent ? { agent: detail.agent } : {}),
        ...(detail?.location?.directory ? { directory: detail.location.directory } : {}),
        ...(detail?.parentID ? { parentID: detail.parentID } : {}),
        ...(detail && modelLabel(detail) ? { model: modelLabel(detail) } : {}),
        running: this.running.has(id),
        lastSeenAt,
        lastSeenSource: lastEvent && lastEvent >= (lastSession ?? '') ? 'event' : 'session',
        eventCount: activity?.eventCount ?? 0,
        ...(activity?.lastEventType ? { lastEventType: activity.lastEventType } : {}),
      })
    }
    rows.sort((left, right) => right.lastSeenAt.localeCompare(left.lastSeenAt))
    return { ...this.summary(), sessions: rows }
  }

  private makeClient(config: OpenCodeConfig): ReturnType<typeof OpenCode.make> {
    return OpenCode.make({
      baseUrl: config.url,
      ...(config.password
        ? {
            headers: {
              authorization: basicAuth(config.password),
            },
          }
        : {}),
    })
  }

  private refreshConfig(): boolean {
    const next = this.configSource()
    const changed =
      next.url !== this.config.url ||
      next.password !== this.config.password ||
      next.source !== this.config.source ||
      next.serviceFile !== this.config.serviceFile
    this.config = next
    if (!changed) return false
    this.client = this.makeClient(next)
    this.activity.clear()
    this.details.clear()
    this.running.clear()
    this.clearError()
    return true
  }

  private async loop(): Promise<void> {
    while (!this.stopped) {
      this.refreshConfig()
      const controller = new AbortController()
      this.controller = controller
      try {
        let opened = false
        for await (const event of this.client.event.subscribe({
          signal: controller.signal,
        })) {
          if (!opened) {
            opened = true
            this.connected = true
            this.reachable = true
            this.clearError()
            this.publish()
            void this.refresh()
          }
          this.observe(event)
        }
        if (!this.stopped) {
          this.connected = false
          this.reachable = false
          this.setError('The OpenCode event stream closed.')
          this.publish()
        }
      } catch (cause) {
        if (!this.stopped && !controller.signal.aborted) {
          this.connected = false
          this.reachable = false
          this.setError(message(cause))
          this.publish()
        }
      }
      if (this.stopped) break
      await sleep(RETRY_MS)
    }
  }

  private observe(event: OpenCodeEvent): void {
    const sessionID = eventSessionID(event)
    if (!sessionID) return
    const now = new Date().toISOString()
    const seenAt = eventTime(event, now)
    const current = this.activity.get(sessionID)
    this.activity.set(sessionID, {
      firstSeenAt: current?.firstSeenAt ?? seenAt,
      lastSeenAt: seenAt,
      lastEventType: typeof event.type === 'string' ? event.type : undefined,
      eventCount: (current?.eventCount ?? 0) + 1,
    })
    this.updatedAt = now
    if (!this.details.has(sessionID)) void this.enrich(sessionID)
    this.publish()
  }

  private async refresh(): Promise<void> {
    if (this.refreshing) return this.refreshing
    this.refreshing = this.refreshNow().finally(() => {
      this.refreshing = undefined
    })
    return this.refreshing
  }

  private async refreshNow(): Promise<void> {
    const changed = this.refreshConfig()
    if (changed && this.connected) this.controller?.abort()
    const signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    let error: string | undefined

    const listed = await this.client.session
      .list({ limit: MAX_SESSIONS, order: 'desc' }, { signal })
      .catch((cause: unknown) => {
        error = message(cause)
        return undefined
      })
    if (listed) {
      for (const info of listed.data) {
        if (info?.id) this.details.set(info.id, info)
      }
    }

    const active = await this.client.session.active({ signal }).catch((cause: unknown) => {
      error = message(cause)
      return undefined
    })
    if (active) {
      this.running.clear()
      for (const id of Object.keys(active)) this.running.add(id)
    }

    await Promise.all(
      [...this.activity.keys()].filter((id) => !this.details.has(id)).map((id) => this.enrich(id))
    )

    this.reachable = Boolean(listed || active) || this.connected
    if (error) this.setError(error)
    else if (this.connected || listed || active) this.clearError()
    this.updatedAt = new Date().toISOString()
    this.publish()
  }

  private async enrich(sessionID: string): Promise<void> {
    if (this.details.has(sessionID) || this.enriching.has(sessionID)) return
    this.enriching.add(sessionID)
    try {
      const info = await this.client.session.get(
        { sessionID },
        { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }
      )
      this.details.set(sessionID, info)
    } catch {
      // A session can disappear between an event and this lookup.
    } finally {
      this.enriching.delete(sessionID)
      this.publish()
    }
  }

  private setError(error: string): void {
    const explanation = explainOpenCodeError(error, this.config)
    this.error = error
    this.errorKind = explanation.kind
    this.hint = explanation.hint
  }

  private clearError(): void {
    this.error = undefined
    this.errorKind = undefined
    this.hint = undefined
  }

  private publish(): void {
    this.onChange(this.summary())
  }
}
