import { AdapterError } from '@clara/adapter-runtime'
import { PiRpcError } from './pi/client.ts'

export { AdapterError }

/** Translate Pi process failures into the adapter's wire shape. */
export function toPiError(cause: unknown): AdapterError {
  if (cause instanceof AdapterError) return cause
  const message = cause instanceof Error ? cause.message : String(cause)
  const lower = message.toLowerCase()
  if (cause instanceof PiRpcError && lower.includes('closing')) {
    return new AdapterError(503, 'harness_offline', 'The Pi process is shutting down')
  }
  if (lower.includes('not found') && lower.includes('session')) {
    return new AdapterError(404, 'SessionNotFoundError', message)
  }
  if (lower.includes('model not found')) {
    return new AdapterError(400, 'invalid_request', message)
  }
  if (lower.includes('did not answer') || lower.includes('timed out')) {
    return new AdapterError(504, 'timeout', message)
  }
  if (
    lower.includes('enoent') ||
    lower.includes('exited with code') ||
    lower.includes('is not running')
  ) {
    return new AdapterError(502, 'harness_offline', message)
  }
  if (
    lower.includes('not signed in') ||
    lower.includes('no credential') ||
    lower.includes('api key')
  ) {
    return new AdapterError(502, 'harness_auth', message)
  }
  return new AdapterError(502, 'upstream_error', message)
}
