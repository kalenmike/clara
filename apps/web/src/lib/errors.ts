/** A readable message for anything thrown by the client or transport. */
export function errorMessage(cause: unknown): string {
  if (cause instanceof Error) return cause.message
  if (typeof cause === 'object' && cause && 'message' in cause) {
    return String(cause.message)
  }
  return 'Unknown error'
}

/** The stack trace when one exists; shown only in development. */
export function errorStack(cause: unknown): string | undefined {
  if (cause instanceof Error) return cause.stack
  if (typeof cause === 'object' && cause && 'stack' in cause) {
    return typeof cause.stack === 'string' ? cause.stack : undefined
  }
  return undefined
}
