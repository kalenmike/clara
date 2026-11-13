/** Errors raised by the adapter surface, translated to the harness wire shape. */
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

/**
 * Translate Agent SDK, filesystem, and git failures into the adapter's wire
 * shape. Abort errors stay untouched so the streaming layer can close cleanly.
 */
export function toAdapterError(cause: unknown): AdapterError {
  if (isAbort(cause)) throw cause
  if (cause instanceof AdapterError) return cause

  const message = errorMessage(cause)
  const lower = message.toLowerCase()
  const status = errorStatus(cause)

  if (
    status === 401 ||
    status === 403 ||
    lower.includes('authentication') ||
    lower.includes('not logged in') ||
    lower.includes('invalid api key') ||
    lower.includes('oauth token') ||
    lower.includes('unauthorized')
  ) {
    return new AdapterError(502, 'harness_auth', message || 'Claude Code rejected the credentials')
  }

  if (status === 429 || lower.includes('rate limit') || lower.includes('too many requests')) {
    return new AdapterError(429, 'rate_limit', message || 'Claude Code is rate limited')
  }

  if (status === 529 || lower.includes('overloaded')) {
    return new AdapterError(503, 'overloaded', message || 'Claude Code is overloaded')
  }

  if (lower.includes('session not found') || lower.includes('no conversation found')) {
    return new AdapterError(404, 'SessionNotFoundError', message)
  }

  if (lower.includes('not found') && lower.includes('session')) {
    return new AdapterError(404, 'SessionNotFoundError', message)
  }

  return new AdapterError(status ?? 502, 'upstream_error', message)
}

export function errorMessage(cause: unknown): string {
  if (cause instanceof Error) return cause.message
  if (typeof cause === 'string') return cause
  if (isRecord(cause) && typeof cause.message === 'string') return cause.message
  return String(cause)
}

function errorStatus(cause: unknown): number | undefined {
  if (!isRecord(cause)) return undefined
  if (typeof cause.status === 'number') return cause.status
  if (typeof cause.statusCode === 'number') return cause.statusCode
  if (isRecord(cause.cause) && typeof cause.cause.status === 'number') return cause.cause.status
  return undefined
}

function isAbort(cause: unknown): boolean {
  let current: unknown = cause
  for (let depth = 0; depth < 8 && current !== undefined; depth += 1) {
    if (current instanceof Error && current.name === 'AbortError') return true
    if (!isRecord(current)) return false
    current = current.cause
  }
  return false
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
