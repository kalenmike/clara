import type { RelayRole } from './protocol.ts'
import type { PROTOCOL_VERSION } from './protocol.ts'

/**
 * The first frame on a session is always plaintext so both sides can derive
 * direction-specific keys. Everything after it is sealed.
 */
export type HelloFrame = {
  t: 'hello'
  v: typeof PROTOCOL_VERSION
  sid: string
  nonce: string
  role: RelayRole
}

export type SealedFrame = {
  t: 'sealed'
  v: typeof PROTOCOL_VERSION
  sid: string
  seq: number
  iv: string
  ct: string
}

export type WireFrame = HelloFrame | SealedFrame

export function isHelloFrame(value: unknown): value is HelloFrame {
  if (!isRecord(value)) return false
  return (
    value.t === 'hello' &&
    value.v === 1 &&
    typeof value.sid === 'string' &&
    value.sid.length > 0 &&
    typeof value.nonce === 'string' &&
    value.nonce.length > 0 &&
    (value.role === 'agent' || value.role === 'client')
  )
}

export function isSealedFrame(value: unknown): value is SealedFrame {
  if (!isRecord(value)) return false
  return (
    value.t === 'sealed' &&
    value.v === 1 &&
    typeof value.sid === 'string' &&
    value.sid.length > 0 &&
    typeof value.seq === 'number' &&
    Number.isSafeInteger(value.seq) &&
    value.seq >= 0 &&
    typeof value.iv === 'string' &&
    typeof value.ct === 'string'
  )
}

export function parseWireFrame(value: unknown): WireFrame | null {
  if (isHelloFrame(value) || isSealedFrame(value)) return value
  return null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
