/** Errors raised by an adapter surface, translated to the harness wire shape. */
export class AdapterError extends Error {
  readonly status: number
  readonly code: string
  readonly details?: unknown

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message)
    this.name = 'AdapterError'
    this.status = status
    this.code = code
    if (details !== undefined) this.details = details
  }
}

const CONNECTION_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ETIMEDOUT',
])

const CONNECTION_TEXT = [
  'econnrefused',
  'econnreset',
  'ehostunreach',
  'enetunreach',
  'enotfound',
  'eai_again',
  'etimedout',
  'connection refused',
  'connection reset',
  'connection closed',
  'connection timed out',
  'timed out',
  'network is unreachable',
  'socket hang up',
]

type ErrorLike = {
  message?: unknown
  code?: unknown
  type?: unknown
  error?: unknown
}

/**
 * Turn a thrown value into a line a person can act on. WebSocket clients in
 * Node and Bun disagree about error shapes: a `ws` socket reports an `Error`
 * with a `code`, while Bun can report an `ErrorEvent` whose cause sits under
 * `error`. `String(cause)` turns the latter into `[object ErrorEvent]`, which
 * tells nobody anything.
 */
export function describeError(cause: unknown): string {
  if (typeof cause === 'string') return cause.trim() ? cause : 'Unknown error'
  if (cause instanceof Error) {
    const code = (cause as NodeJS.ErrnoException).code
    const message = cause.message || cause.name || 'Unknown error'
    if (code && !message.includes(code)) return `${message} (${code})`
    return message
  }
  if (cause && typeof cause === 'object') {
    const value = cause as ErrorLike
    if (value.error !== undefined && value.error !== cause) {
      const nested = describeError(value.error)
      if (nested && nested !== 'Unknown error') return nested
    }
    if (typeof value.message === 'string' && value.message.trim()) return value.message
    if (typeof value.code === 'string' && value.code.trim()) return value.code
    if (typeof value.type === 'string' && value.type.trim()) {
      return `WebSocket ${value.type}`
    }
  }
  const text = String(cause)
  return text === '[object ErrorEvent]' ? 'WebSocket error' : text
}

/** Whether a failed connection should mention the hub address and reachability. */
export function isConnectionFailure(cause: unknown): boolean {
  if (cause && typeof cause === 'object') {
    const value = cause as ErrorLike
    if (typeof value.code === 'string' && CONNECTION_CODES.has(value.code.toUpperCase())) {
      return true
    }
    if (value.error !== undefined && value.error !== cause && isConnectionFailure(value.error)) {
      return true
    }
  }
  const text = describeError(cause).toLowerCase()
  return CONNECTION_TEXT.some((needle) => text.includes(needle))
}
