import { OpenCode } from '@opencode/client'
import type { OpenCodeEvent, SessionInfo } from '@opencode/client'
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

/**
 * Tracks live OpenCode sessions without exposing the OpenCode password to the
 * browser. The event stream gives us last-seen activity; the session list seeds
 * idle sessions and their metadata so rogue sessions still show up.
 */
export class OpenCodeObserver {
  private readonly config: { url: string; password?: string }
  private readonly onChange: (summary: OpenCodeSummary) => void
  private readonly client: ReturnType<typeof OpenCode.make>
  private readonly activity = new Map<string, SessionActivity>()
  private readonly details = new Map<string, SessionInfo>()
  private readonly running = new Set<string>()
  private readonly enriching = new Set<string>()
  private controller: AbortController | undefined
  private loopPromise: Promise<void> | undefined
  private stopped = false
  private refreshing: Promise<void> | undefined
  private connected = false
  private reachable = false
  private error: string | undefined
  private updatedAt = new Date().toISOString()

  constructor(config: { url: string; password?: string }, onChange: (summary: OpenCodeSummary) => void) {
    this.config = config
    this.onChange = onChange
    this.client = OpenCode.make({
      baseUrl: config.url,
      ...(config.password
        ? {
            headers: {
              authorization: `Basic ${Buffer.from(`opencode:${config.password}`).toString('base64')}`,
            },
          }
        : {}),
    })
  }

  start(): void {
    if (this.loopPromise) return
    this.stopped = false
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

  summary(): OpenCodeSummary {
    const ids = new Set([...this.details.keys(), ...this.activity.keys()])
    return {
      connected: this.connected,
      reachable: this.reachable,
      url: this.config.url,
      sessionCount: ids.size,
      activeCount: this.running.size,
      updatedAt: this.updatedAt,
      ...(this.error ? { error: this.error } : {}),
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

  private async loop(): Promise<void> {
    while (!this.stopped) {
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
            this.error = undefined
            this.publish()
            void this.refresh()
          }
          this.observe(event)
        }
        if (!this.stopped) {
          this.connected = false
          this.reachable = false
          this.error = 'The OpenCode event stream closed.'
          this.publish()
        }
      } catch (cause) {
        if (!this.stopped && !controller.signal.aborted) {
          this.connected = false
          this.reachable = false
          this.error = message(cause)
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

    const active = await this.client.session
      .active({ signal })
      .catch((cause: unknown) => {
        error = message(cause)
        return undefined
      })
    if (active) {
      this.running.clear()
      for (const id of Object.keys(active)) this.running.add(id)
    }

    await Promise.all(
      [...this.activity.keys()]
        .filter((id) => !this.details.has(id))
        .map((id) => this.enrich(id))
    )

    this.reachable = Boolean(listed || active) || this.connected
    this.error = error
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

  private publish(): void {
    this.onChange(this.summary())
  }
}
