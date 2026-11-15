import type { SessionMailboxSignals } from '@clara/shared-types'
import type { ApiDependencies } from '../api/context.ts'
import type { HarnessRequest } from '../harness/types.ts'
import { loadSessionSignals } from '../push/attention.ts'

/** Match the activity cache: a session's signals stay valid until it changes. */
const SIGNAL_CACHE_MS = 5 * 60_000
/** Enough parallel harness reads to fill a sidebar without swamping an adapter. */
const SIGNAL_WORKERS = 6
/** One slow harness must not hold the whole batch past this. */
const SIGNAL_TIMEOUT_MS = 2_500
/** Expired entries are swept at most once a minute. */
const SWEEP_INTERVAL_MS = 60_000

type CacheEntry = {
  at: number
  updated: number
  signals: SessionMailboxSignals
}

export type SessionSignalRequest = {
  sessionID: string
  /** The session's `time.updated`, which invalidates its cached signals. */
  updated: number
}

export type SessionSignalEntry = {
  sessionID: string
  signals: SessionMailboxSignals
}

export type SessionSignalsOptions = {
  /** Ignore every cached entry, as the activity view's manual refresh does. */
  refresh?: boolean
}

/**
 * Read mailbox signals for many sessions in one call. The browser used to ask
 * three times per listed session, which queued behind the relay's per-device
 * frame budget; the hub now fans out locally, shares one cache with the
 * activity view, and answers the sidebar in one request.
 */
export class SessionSignalsService {
  private readonly deps: ApiDependencies
  private readonly cache = new Map<string, CacheEntry>()
  private readonly inflight = new Map<string, Promise<SessionMailboxSignals>>()
  private sweptAt = 0

  constructor(deps: ApiDependencies) {
    this.deps = deps
  }

  /** Signals for the requested sessions. Unresolvable sessions are omitted. */
  async load(
    requests: readonly SessionSignalRequest[],
    signal: AbortSignal,
    options: SessionSignalsOptions = {}
  ): Promise<SessionSignalEntry[]> {
    this.sweep(Date.now())

    let failures = 0
    let firstFailure: unknown
    const entries = await mapLimit(requests, SIGNAL_WORKERS, signal, async (request) => {
      const harnessID = this.deps.harness.metadata.harnessIdForSession(request.sessionID)
      if (!harnessID || !this.deps.harness.connection(harnessID)) return null
      try {
        const signals = await this.forSession(
          harnessID,
          request.sessionID,
          request.updated,
          options
        )
        return { sessionID: request.sessionID, signals } satisfies SessionSignalEntry
      } catch (cause) {
        failures += 1
        if (firstFailure === undefined) firstFailure = cause
        return null
      }
    })

    if (firstFailure !== undefined) {
      this.deps.log(
        `${failures} session ${failures === 1 ? 'signal' : 'signals'} could not be loaded`,
        firstFailure
      )
    }

    return entries.filter((entry): entry is SessionSignalEntry => entry !== null)
  }

  /**
   * Signals for one session that the caller already listed. The updated stamp
   * is part of the cache key, so a changed session is re-read while its
   * neighbours stay cached.
   */
  forSession(
    harnessID: string,
    sessionID: string,
    updated: number,
    options: SessionSignalsOptions = {}
  ): Promise<SessionMailboxSignals> {
    const key = `${harnessID}:${sessionID}`
    const now = Date.now()
    if (!options.refresh) {
      const cached = this.cache.get(key)
      if (cached && cached.updated === updated && now - cached.at < SIGNAL_CACHE_MS) {
        return Promise.resolve(cached.signals)
      }
    }

    const inflightKey = `${key}:${updated}`
    const existing = this.inflight.get(inflightKey)
    if (existing) return existing

    const client: HarnessRequest = {
      request: (input, requestSignal) =>
        this.deps.harness.requestFor(harnessID, input, requestSignal),
    }
    const task = withDeadline(loadSessionSignals(client, sessionID), SIGNAL_TIMEOUT_MS)
      .then((signals) => {
        this.cache.set(key, { at: Date.now(), updated, signals })
        return signals
      })
      .finally(() => {
        this.inflight.delete(inflightKey)
      })
    this.inflight.set(inflightKey, task)
    return task
  }

  /** Drop cached signals for sessions the caller no longer lists. */
  prune(harnessID: string, sessionIDs: readonly string[]): void {
    const prefix = `${harnessID}:`
    const keep = new Set(sessionIDs.map((sessionID) => `${prefix}${sessionID}`))
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix) && !keep.has(key)) this.cache.delete(key)
    }
  }

  private sweep(now: number): void {
    if (now - this.sweptAt < SWEEP_INTERVAL_MS) return
    this.sweptAt = now
    for (const [key, entry] of this.cache) {
      if (now - entry.at >= SIGNAL_CACHE_MS) this.cache.delete(key)
    }
  }
}

function withDeadline<T>(task: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Session signals timed out')), timeoutMs)
    task.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (cause) => {
        clearTimeout(timer)
        reject(cause)
      }
    )
  })
}

async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  signal: AbortSignal,
  run: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (!signal.aborted) {
      const index = next
      next += 1
      if (index >= items.length) return
      results[index] = await run(items[index]!)
    }
  })
  await Promise.all(workers)
  return results
}
