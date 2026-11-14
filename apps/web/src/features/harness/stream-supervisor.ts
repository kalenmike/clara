import type { ClaraEvent } from '@clara/api-contract'
import type { ClaraClient } from '@/lib/client'
import type { StreamState } from './stream-state'

/** The server writes an SSE heartbeat every 15 seconds. */
const HEARTBEAT_MS = 15_000
/** Three missed heartbeats mean the socket is half-open rather than idle. */
const STALL_MS = HEARTBEAT_MS * 3
const WATCHDOG_MS = 5_000
const MAX_BACKOFF_MS = 15_000
/** A connection must survive this long before it resets the backoff. */
const STABLE_MS = 10_000

export type HarnessStreamOptions = {
  client: ClaraClient
  /** Omit to stream the active/default harness. */
  harnessID?: string
  onEvent: (event: ClaraEvent) => void
  onState: (state: StreamState) => void
  onError: (message: string) => void
  /** Called once a stream that had dropped receives data again. */
  onRecovered: (downForMs: number) => void
}

export type HarnessStreamHandle = {
  stop: () => void
}

/**
 * Keep one harness's event stream alive. The watchdog aborts half-open sockets,
 * backoff restarts a dropped stream, and a stream that survives long enough
 * forgets its retry count.
 */
export function superviseHarnessStream(options: HarnessStreamOptions): HarnessStreamHandle {
  const { client, harnessID, onEvent, onState, onError, onRecovered } = options
  const controller = new AbortController()
  let retry = 0
  let cancelSleep: (() => void) | null = null
  let active: AbortController | null = null
  let connected = false
  let hadFailure = false
  let downSince = 0
  let lastActivity = Date.now()
  let stableTimer: number | null = null

  onState('connecting')

  const sleep = (ms: number) =>
    new Promise<void>((resolve) => {
      const timer = window.setTimeout(resolve, ms)
      cancelSleep = () => {
        window.clearTimeout(timer)
        resolve()
      }
    })

  /** Runs on every raw chunk, including keepalive comments. */
  const markAlive = () => {
    if (controller.signal.aborted) return
    lastActivity = Date.now()
    if (connected) return
    connected = true
    if (stableTimer === null) {
      stableTimer = window.setTimeout(() => {
        stableTimer = null
        retry = 0
      }, STABLE_MS)
    }
    onState('live')
    if (hadFailure) {
      // Events that arrived while the stream was down were never replayed.
      onRecovered(Date.now() - downSince)
      hadFailure = false
      downSince = 0
    }
  }

  const markDown = () => {
    if (stableTimer !== null) {
      window.clearTimeout(stableTimer)
      stableTimer = null
    }
    connected = false
    if (!hadFailure) {
      hadFailure = true
      downSince = Date.now()
    }
    onState('reconnecting')
  }

  const run = async () => {
    while (!controller.signal.aborted) {
      const attempt = new AbortController()
      active = attempt
      lastActivity = Date.now()
      const abortAttempt = () => attempt.abort()
      controller.signal.addEventListener('abort', abortAttempt, { once: true })

      try {
        for await (const event of client.event.subscribe({
          ...(harnessID ? { harnessID } : {}),
          signal: attempt.signal,
          onActivity: markAlive,
        })) {
          markAlive()
          onEvent(event)
        }
      } catch (cause) {
        if (!controller.signal.aborted) onError(describeStreamError(cause))
      } finally {
        controller.signal.removeEventListener('abort', abortAttempt)
        if (active === attempt) active = null
      }

      if (controller.signal.aborted) break
      markDown()
      retry += 1
      await sleep(backoff(retry))
    }
  }

  // A half-open SSE socket never rejects, so the loop alone would wait forever.
  const watchdog = window.setInterval(() => {
    if (Date.now() - lastActivity > STALL_MS) active?.abort()
  }, WATCHDOG_MS)

  void run()

  return {
    stop: () => {
      controller.abort()
      active?.abort()
      window.clearInterval(watchdog)
      if (stableTimer !== null) window.clearTimeout(stableTimer)
      cancelSleep?.()
    },
  }
}

function describeStreamError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  return 'The event stream disconnected.'
}

function backoff(attempt: number): number {
  const base = Math.min(1000 * 2 ** Math.min(attempt, 4), MAX_BACKOFF_MS)
  // Jitter keeps several tabs from reconnecting in lockstep.
  return base * (0.8 + Math.random() * 0.4)
}
