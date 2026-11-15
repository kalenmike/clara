import { useEffect, useReducer } from 'react'
import { getState, resolveLabPath, streamFetch, streamURL } from './api'
import type { CallRecord, LabSnapshot, OrcEvent, StreamItem } from './types'

export interface LabStream {
  snapshot: LabSnapshot | null
  calls: CallRecord[]
  events: OrcEvent[]
  eventRevision: number
  previewRevision: number
  error: string | null
}

/** One dispatched server-sent event. */
export interface SseMessage {
  /** Event name, `message` when the block carried no `event:` field. */
  event: string
  /** Joined `data:` lines; empty for blocks that only carry `retry:`. */
  data: string
  id: string | null
  /** Reconnection time in milliseconds requested by the server. */
  retry: number | null
}

export interface SseParser {
  /** Feed decoded text and get every event completed by it. */
  push(chunk: string): SseMessage[]
}

/**
 * Incremental `text/event-stream` parser.
 *
 * Handles `event:`, `data:`, `id:`, `retry:` and `:` comment lines (heartbeats)
 * and tolerates events split across chunks. Blocks without data are only
 * reported when they carry a `retry:`, so comments stay silent.
 */
export function createSseParser(): SseParser {
  let buffer = ''

  return {
    push(chunk: string): SseMessage[] {
      buffer += buffer === '' ? chunk.replace(/^\uFEFF/, '') : chunk
      const messages: SseMessage[] = []
      let boundary = nextBoundary(buffer)
      while (boundary) {
        const block = buffer.slice(0, boundary.index)
        buffer = buffer.slice(boundary.index + boundary.length)
        const message = parseBlock(block)
        if (message) messages.push(message)
        boundary = nextBoundary(buffer)
      }
      return messages
    },
  }
}

function nextBoundary(value: string): { index: number; length: number } | null {
  const lf = value.indexOf('\n\n')
  const crlf = value.indexOf('\r\n\r\n')
  if (lf === -1 && crlf === -1) return null
  if (crlf !== -1 && (lf === -1 || crlf <= lf)) return { index: crlf, length: 4 }
  return { index: lf, length: 2 }
}

function parseBlock(block: string): SseMessage | null {
  const data: string[] = []
  let event = 'message'
  let id: string | null = null
  let retry: number | null = null

  for (const line of block.split(/\r\n|\n|\r/)) {
    if (!line || line.startsWith(':')) continue
    const colon = line.indexOf(':')
    const field = colon === -1 ? line : line.slice(0, colon)
    const raw = colon === -1 ? '' : line.slice(colon + 1)
    const value = raw.startsWith(' ') ? raw.slice(1) : raw
    if (field === 'data') {
      data.push(value)
    } else if (field === 'event') {
      event = value || 'message'
    } else if (field === 'id') {
      id = value
    } else if (field === 'retry') {
      const parsed = Number.parseInt(value, 10)
      if (Number.isFinite(parsed) && parsed >= 0) retry = parsed
    }
  }

  if (data.length === 0 && retry === null) return null
  return { event, data: data.join('\n'), id, retry }
}

const MAX_CALLS = 600
const MAX_EVENTS = 2_000
const MIN_RETRY_MS = 500
const MAX_RETRY_MS = 10_000
const DEFAULT_RETRY_MS = 1_000

const DISCONNECTED = 'The lab event stream is disconnected. Reconnecting…'

type StreamAction =
  | { type: 'snapshot'; snapshot: LabSnapshot }
  | { type: 'state'; patch: Partial<LabSnapshot> }
  | { type: 'call'; call: CallRecord }
  | { type: 'event'; event: OrcEvent }
  | { type: 'preview' }
  | { type: 'error'; error: string | null }

const emptyStream: LabStream = {
  snapshot: null,
  calls: [],
  events: [],
  eventRevision: 0,
  previewRevision: 0,
  error: null,
}

function reduceStream(state: LabStream, action: StreamAction): LabStream {
  switch (action.type) {
    case 'snapshot':
      return {
        ...state,
        snapshot: action.snapshot,
        calls: action.snapshot.calls,
        events: action.snapshot.events,
        error: null,
      }
    case 'state':
      return state.snapshot ? { ...state, snapshot: { ...state.snapshot, ...action.patch } } : state
    case 'call':
      if (state.calls.some((call) => call.id === action.call.id)) return state
      return { ...state, calls: [...state.calls, action.call].slice(-MAX_CALLS) }
    case 'event':
      if (state.events.some((entry) => entry.id === action.event.id)) return state
      return {
        ...state,
        events: [...state.events, action.event].slice(-MAX_EVENTS),
        eventRevision: state.eventRevision + 1,
      }
    case 'preview':
      return { ...state, previewRevision: state.previewRevision + 1 }
    case 'error':
      return state.error === action.error ? state : { ...state, error: action.error }
  }
}

function toAction(message: SseMessage): StreamAction | null {
  if (!message.data) return null
  let payload: unknown
  try {
    payload = JSON.parse(message.data) as unknown
  } catch {
    return null
  }
  switch (message.event) {
    case 'snapshot':
      return { type: 'snapshot', snapshot: (payload as StreamItem<LabSnapshot>).data }
    case 'state':
      return { type: 'state', patch: (payload as StreamItem<Partial<LabSnapshot>>).data }
    case 'call':
      return { type: 'call', call: (payload as StreamItem<CallRecord>).data }
    case 'event':
      return { type: 'event', event: (payload as StreamItem<OrcEvent>).data }
    case 'preview':
      return { type: 'preview' }
    default:
      return null
  }
}

export interface StreamHandlers {
  message: (message: SseMessage) => void
  open: () => void
  close: () => void
}

/** Read one connection until the server closes it or `signal` aborts. */
async function readStream(
  handlers: StreamHandlers,
  signal: AbortSignal,
  onRetry: (ms: number) => void
): Promise<void> {
  const response = await streamFetch()(resolveLabPath(streamURL()), {
    method: 'GET',
    headers: { accept: 'text/event-stream' },
    cache: 'no-store',
    signal,
  })
  if (!response.ok) throw new Error(`Clara Lab stream returned ${response.status}`)
  if (!response.body) throw new Error('Clara Lab stream returned no body')

  handlers.open()
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const parser = createSseParser()
  try {
    while (!signal.aborted) {
      const { done, value } = await reader.read()
      if (done) break
      for (const message of parser.push(decoder.decode(value, { stream: true }))) {
        if (message.retry !== null) onRetry(message.retry)
        handlers.message(message)
      }
    }
  } finally {
    reader.releaseLock()
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve()
  return new Promise((resolve) => {
    const finish = (): void => {
      clearTimeout(timer)
      signal.removeEventListener('abort', finish)
      resolve()
    }
    const timer = setTimeout(finish, ms)
    signal.addEventListener('abort', finish, { once: true })
  })
}

/**
 * Keep one stream open, reconnecting with a short backoff until aborted.
 *
 * Exported for tests; the hook owns the only production call site.
 */
export async function runStream(handlers: StreamHandlers, signal: AbortSignal): Promise<void> {
  let retry = DEFAULT_RETRY_MS
  while (!signal.aborted) {
    try {
      await readStream(handlers, signal, (ms) => {
        retry = Math.min(Math.max(ms, MIN_RETRY_MS), MAX_RETRY_MS)
      })
      if (signal.aborted) return
      handlers.close()
    } catch {
      if (signal.aborted) return
      handlers.close()
    }
    await sleep(retry, signal)
    retry = Math.min(retry * 2, MAX_RETRY_MS)
  }
}

export function useLabStream(): LabStream {
  const [stream, dispatch] = useReducer(reduceStream, emptyStream)

  useEffect(() => {
    let alive = true
    const controller = new AbortController()

    void getState()
      .then((state) => {
        if (alive) dispatch({ type: 'snapshot', snapshot: state })
      })
      .catch((cause: unknown) => {
        if (alive)
          dispatch({ type: 'error', error: cause instanceof Error ? cause.message : String(cause) })
      })

    void runStream(
      {
        message: (message) => {
          const action = toAction(message)
          if (action) dispatch(action)
        },
        open: () => dispatch({ type: 'error', error: null }),
        close: () => dispatch({ type: 'error', error: DISCONNECTED }),
      },
      controller.signal
    )

    return () => {
      alive = false
      controller.abort()
    }
  }, [])

  return stream
}
