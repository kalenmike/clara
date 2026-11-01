/** A readable message for anything thrown by the client or transport. */
export function errorMessage(cause: unknown): string {
  if (cause instanceof Error) return cause.message
  if (typeof cause === 'object' && cause && 'message' in cause) {
    return String(cause.message)
  }
  return 'Unknown error'
}
