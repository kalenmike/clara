import { RELAY_GRANT_MAX_ID_LENGTH } from './grant.ts'
import {
  PROTOCOL_VERSION,
  PROTOCOL_VERSION_V4,
  type DeviceErrorCode,
  type RelayRole,
} from './protocol.ts'

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
  /** True for a harness adapter session rather than a browser device. */
  adapter?: boolean
  /** Long-lived adapter credential id. */
  adapterId?: string
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

/**
 * The v4 client hello carries a fresh P-256 ephemeral public point. A browser
 * carries `deviceId` or `enrollId`. An adapter carries `adapterId` with
 * `adapter: true`, and may also carry `enrollId` while it is enrolling.
 */
export type ClientHelloFrameV4 = {
  t: 'hello'
  v: typeof PROTOCOL_VERSION_V4
  sid: string
  nonce: string
  role: 'client'
  /** Base64url uncompressed P-256 point (65 bytes). */
  eph: string
  deviceId?: string
  enrollId?: string
  /** True for a harness adapter session rather than a browser device. */
  adapter?: true
  /** Long-lived adapter credential id. */
  adapterId?: string
}

/**
 * The v4 hub hello proves knowledge of the shared static key by MACing the
 * transcript that covers both ephemeral points and both nonces.
 */
export type HubHelloFrameV4 = {
  t: 'hello'
  v: typeof PROTOCOL_VERSION_V4
  sid: string
  nonce: string
  role: 'agent'
  /** Base64url uncompressed P-256 point (65 bytes). */
  eph: string
  /** Base64url HMAC-SHA-256 over the v4 transcript (32 bytes). */
  mac: string
}

export type HelloFrameV4 = ClientHelloFrameV4 | HubHelloFrameV4

/**
 * Legacy route envelope v2, kept compiling until the transport cutover. The v4
 * relay always sends `i`; use {@link RouteFrameV3} after the cutover. The relay
 * assigns `p` itself, so the hub can tie a session to the socket that opened it
 * instead of trusting the `sid` a client claims. `b` marks `m` as base64url
 * bytes rather than frame text.
 */
export type RouteFrame = {
  t: 'route'
  v: typeof PROTOCOL_VERSION
  /** Relay-assigned peer id for the client socket. */
  p: string
  /** True when `m` carries bytes instead of frame text. */
  b?: boolean
  m: string
}

/**
 * Route envelope v3. The relay verifies the client's grant before upgrading
 * and tags every client frame with the grant id, so the hub can bind the
 * session identity to the credential that opened the socket instead of trusting
 * the hello.
 */
export type RouteFrameV3 = {
  t: 'route'
  /** E2EE protocol version, not the route envelope version. */
  v: typeof PROTOCOL_VERSION
  /** Relay-assigned peer id for the client socket. */
  p: string
  /** Verified grant id: a device id, adapter id, or enrollment id. */
  i: string
  /** True when `m` carries bytes instead of frame text. */
  b?: boolean
  m: string
}

const DEVICE_ERROR_CODES: readonly DeviceErrorCode[] = [
  'unknown_device',
  'revoked_device',
  'enrollment_expired',
  'enrollment_used',
  'enrollment_invalid',
  'device_limit',
  'invalid_device',
  'not_allowed',
  'protocol_error',
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
    optionalString(value.enrollId) &&
    optionalString(value.adapterId) &&
    (value.adapter === undefined || typeof value.adapter === 'boolean')
  )
}

export function isClientHelloFrameV4(value: unknown): value is ClientHelloFrameV4 {
  if (!isRecord(value)) return false
  if (
    value.t !== 'hello' ||
    value.v !== PROTOCOL_VERSION_V4 ||
    value.role !== 'client' ||
    !isTranscriptField(value.sid) ||
    !isTranscriptField(value.nonce) ||
    !isP256Point(value.eph)
  ) {
    return false
  }
  if (value.adapter !== undefined && value.adapter !== true) return false

  const hasDevice = value.deviceId !== undefined
  const hasEnroll = value.enrollId !== undefined
  const hasAdapter = value.adapterId !== undefined
  if (!hasDevice && !hasEnroll && !hasAdapter) return false
  if (hasDevice && (hasEnroll || hasAdapter)) return false
  if (hasDevice && value.adapter === true) return false
  // An adapter may send its stable id alongside enrollId during enrollment.
  if (hasAdapter && value.adapter !== true) return false
  return [value.deviceId, value.enrollId, value.adapterId].every(
    (item) => item === undefined || isNonEmptyString(item)
  )
}

export function isHubHelloFrameV4(value: unknown): value is HubHelloFrameV4 {
  if (!isRecord(value)) return false
  return (
    value.t === 'hello' &&
    value.v === PROTOCOL_VERSION_V4 &&
    value.role === 'agent' &&
    isTranscriptField(value.sid) &&
    isTranscriptField(value.nonce) &&
    isP256Point(value.eph) &&
    isHmac(value.mac)
  )
}

export function isHelloFrameV4(value: unknown): value is HelloFrameV4 {
  return isClientHelloFrameV4(value) || isHubHelloFrameV4(value)
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

/** Legacy v2 guard; the v4 hub uses {@link isRouteFrameV3}. */
export function isRouteFrame(value: unknown): value is RouteFrame {
  if (!isRecord(value)) return false
  return (
    value.t === 'route' &&
    value.v === PROTOCOL_VERSION &&
    typeof value.p === 'string' &&
    value.p.length > 0 &&
    typeof value.m === 'string' &&
    (value.b === undefined || typeof value.b === 'boolean')
  )
}

export function isRouteFrameV3(value: unknown): value is RouteFrameV3 {
  if (!isRecord(value)) return false
  return (
    value.t === 'route' &&
    value.v === PROTOCOL_VERSION &&
    isNonEmptyString(value.p) &&
    isNonEmptyString(value.i) &&
    value.i.length <= RELAY_GRANT_MAX_ID_LENGTH &&
    typeof value.m === 'string' &&
    (value.b === undefined || typeof value.b === 'boolean')
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

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

/**
 * `sid` and `nonce` feed the v4 transcript. `|` delimits its fields, so neither
 * may contain one, and the cap keeps an unauthenticated hello from carrying
 * unbounded strings into the key schedule.
 */
export const MAX_HANDSHAKE_FIELD_LENGTH = RELAY_GRANT_MAX_ID_LENGTH

function isTranscriptField(value: unknown): value is string {
  return (
    isNonEmptyString(value) && value.length <= MAX_HANDSHAKE_FIELD_LENGTH && !value.includes('|')
  )
}

const P256_PUBLIC_KEY_BYTES = 65
const P256_UNCOMPRESSED_PREFIX = 0x04
const HMAC_SHA256_BYTES = 32
const BASE64URL = /^[A-Za-z0-9_-]+$/

function isP256Point(value: unknown): value is string {
  const bytes = decodeBase64Url(value)
  return (
    bytes !== null &&
    bytes.length === P256_PUBLIC_KEY_BYTES &&
    bytes[0] === P256_UNCOMPRESSED_PREFIX
  )
}

function isHmac(value: unknown): value is string {
  const bytes = decodeBase64Url(value)
  return bytes !== null && bytes.length === HMAC_SHA256_BYTES
}

function decodeBase64Url(value: unknown): Uint8Array<ArrayBuffer> | null {
  if (typeof value !== 'string' || !BASE64URL.test(value)) return null
  try {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/')
    const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
    return bytes
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
