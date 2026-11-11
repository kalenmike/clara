import { PROTOCOL_VERSION, type DeviceErrorCode, type RelayRole } from './protocol.ts'

/**
 * The first frame on a session is always plaintext so both sides can derive
 * direction-specific keys. A device session carries `deviceId`; an enrollment
 * session carries `enrollId` and uses the one-time token as its key.
 */
export type HelloFrame = {
  t: 'hello'
  v: typeof PROTOCOL_VERSION
  sid: string
  nonce: string
  role: RelayRole
  deviceId?: string
  enrollId?: string
}

export type SealedFrame = {
  t: 'sealed'
  v: typeof PROTOCOL_VERSION
  sid: string
  seq: number
  iv: string
  ct: string
}

/** Plaintext handshake failure, broadcast by the hub and filtered by sid. */
export type ErrorFrame = {
  t: 'error'
  v: typeof PROTOCOL_VERSION
  sid: string
  code: DeviceErrorCode
  message: string
}

export type WireFrame = HelloFrame | SealedFrame | ErrorFrame

const DEVICE_ERROR_CODES: readonly DeviceErrorCode[] = [
  'unknown_device',
  'revoked_device',
  'enrollment_expired',
  'enrollment_used',
  'enrollment_invalid',
  'device_limit',
  'invalid_device',
  'not_allowed',
]

export function isHelloFrame(value: unknown): value is HelloFrame {
  if (!isRecord(value)) return false
  return (
    value.t === 'hello' &&
    value.v === PROTOCOL_VERSION &&
    typeof value.sid === 'string' &&
    value.sid.length > 0 &&
    typeof value.nonce === 'string' &&
    value.nonce.length > 0 &&
    (value.role === 'agent' || value.role === 'client') &&
    optionalString(value.deviceId) &&
    optionalString(value.enrollId)
  )
}

export function isSealedFrame(value: unknown): value is SealedFrame {
  if (!isRecord(value)) return false
  return (
    value.t === 'sealed' &&
    value.v === PROTOCOL_VERSION &&
    typeof value.sid === 'string' &&
    value.sid.length > 0 &&
    typeof value.seq === 'number' &&
    Number.isSafeInteger(value.seq) &&
    value.seq >= 0 &&
    typeof value.iv === 'string' &&
    typeof value.ct === 'string'
  )
}

export function isErrorFrame(value: unknown): value is ErrorFrame {
  if (!isRecord(value)) return false
  return (
    value.t === 'error' &&
    value.v === PROTOCOL_VERSION &&
    typeof value.sid === 'string' &&
    value.sid.length > 0 &&
    isDeviceErrorCode(value.code) &&
    typeof value.message === 'string'
  )
}

export function parseWireFrame(value: unknown): WireFrame | null {
  if (isHelloFrame(value) || isSealedFrame(value) || isErrorFrame(value)) return value
  return null
}

function isDeviceErrorCode(value: unknown): value is DeviceErrorCode {
  return typeof value === 'string' && DEVICE_ERROR_CODES.includes(value as DeviceErrorCode)
}

function optionalString(value: unknown): boolean {
  return value === undefined || (typeof value === 'string' && value.length > 0)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
