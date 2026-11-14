/**
 * Relay grants replace the shared client token. The relay signs a small
 * payload with the hub's agent token; the grant travels in
 * `Sec-WebSocket-Protocol` as `clara.auth.<grant>`, so the relay can identify
 * the connecting device, adapter, or enrollment without holding a device key.
 */
export const RELAY_GRANT_VERSION = 1

/** A grant id is a device id, adapter id, or enrollment id. */
export const RELAY_GRANT_MAX_ID_LENGTH = 128

/** Allow a little clock skew between the hub and the relay. */
export const RELAY_GRANT_CLOCK_LEEWAY_SECONDS = 60

/** One-time enrollment grants are short-lived; the pairing link owns the TTL. */
export const ENROLLMENT_GRANT_TTL_SECONDS = 10 * 60

/** A device or adapter refreshes its grant on every connect. */
export const DEVICE_GRANT_TTL_SECONDS = 30 * 24 * 60 * 60

/**
 * `exp` is a Unix timestamp in seconds. The encoder writes the fields in this
 * order so a grant signed by one runtime verifies in another.
 */
export type RelayGrantPayload = {
  v: typeof RELAY_GRANT_VERSION
  room: string
  role: 'client'
  id: string
  exp: number
}

/**
 * Attached to the sealed `ready` action so a device can refresh its relay
 * grant on every connect. `expiresAt` is Unix milliseconds.
 */
export type RelayGrantState = {
  grant: string
  expiresAt: number
}

export type RelayGrantFailureReason =
  'malformed' | 'invalid_payload' | 'bad_signature' | 'wrong_room' | 'wrong_role' | 'expired'

export type RelayGrantVerification =
  { ok: true; payload: RelayGrantPayload } | { ok: false; reason: RelayGrantFailureReason }

export type VerifyRelayGrantOptions = {
  /** The relay's agent token, used as the HMAC key. */
  agentToken: string
  /** The room the grant must be scoped to. */
  room: string
  /** Unix seconds; defaults to the current time. */
  nowSeconds?: number
}

/**
 * Encodes the canonical payload. The field order is fixed here, not inherited
 * from the input object.
 */
export function encodeRelayGrantPayload(payload: RelayGrantPayload): string {
  return bytesToBase64Url(
    utf8(
      JSON.stringify({
        v: RELAY_GRANT_VERSION,
        room: payload.room,
        role: 'client',
        id: payload.id,
        exp: payload.exp,
      })
    )
  )
}

/** Parses and validates the payload half of a grant. */
export function decodeRelayGrantPayload(encoded: string): RelayGrantPayload | null {
  const parsed = parsePayload(encoded)
  return parsed.ok ? parsed.payload : null
}

/**
 * Produces `<encodedPayload>.<signature>`. The HMAC key is the relay agent
 * token; the message is the encoded payload exactly as it will travel.
 */
export async function signRelayGrant(
  payload: RelayGrantPayload,
  agentToken: string
): Promise<string> {
  const failure = validatePayload(payload)
  if (failure) throw new Error(`Invalid relay grant: ${failure}`)
  if (!agentToken) throw new Error('The relay agent token is required')
  const encoded = encodeRelayGrantPayload(payload)
  const signature = await hmacSign(agentToken, encoded)
  return `${encoded}.${signature}`
}

/**
 * Creates and signs a grant, returning the string and its expiry in Unix
 * milliseconds for the pairing payload or sealed `ready` action.
 */
export async function createRelayGrant(input: {
  room: string
  id: string
  agentToken: string
  ttlSeconds: number
  nowSeconds?: number
}): Promise<RelayGrantState> {
  if (!Number.isSafeInteger(input.ttlSeconds) || input.ttlSeconds <= 0) {
    throw new Error('The relay grant lifetime must be a positive integer')
  }
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000)
  const exp = now + input.ttlSeconds
  const grant = await signRelayGrant(
    { v: RELAY_GRANT_VERSION, room: input.room, role: 'client', id: input.id, exp },
    input.agentToken
  )
  return { grant, expiresAt: exp * 1000 }
}

/**
 * Verifies a grant at the relay. Structurally invalid payloads are rejected
 * before the HMAC is computed; room, role, and expiry are checked only after
 * the signature proves the payload came from the hub.
 */
export async function verifyRelayGrant(
  grant: string,
  options: VerifyRelayGrantOptions
): Promise<RelayGrantVerification> {
  const parts = grant.split('.')
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, reason: 'malformed' }
  const [encoded, signature] = parts

  const parsed = parsePayload(encoded)
  if (!parsed.ok) return { ok: false, reason: parsed.reason }

  const presented = base64UrlToBytes(signature)
  if (!presented || presented.length !== 32) return { ok: false, reason: 'bad_signature' }

  const expected = base64UrlToBytes(await hmacSign(options.agentToken, encoded))
  if (!expected || !equalBytes(expected, presented)) return { ok: false, reason: 'bad_signature' }

  const payload = parsed.payload
  if (payload.room !== options.room) return { ok: false, reason: 'wrong_room' }
  if (payload.role !== 'client') return { ok: false, reason: 'wrong_role' }

  const now = options.nowSeconds ?? Math.floor(Date.now() / 1000)
  if (now > payload.exp + RELAY_GRANT_CLOCK_LEEWAY_SECONDS) {
    return { ok: false, reason: 'expired' }
  }

  return { ok: true, payload }
}

type ParsedPayload =
  { ok: true; payload: RelayGrantPayload } | { ok: false; reason: 'malformed' | 'invalid_payload' }

function parsePayload(encoded: string): ParsedPayload {
  const bytes = base64UrlToBytes(encoded)
  if (!bytes) return { ok: false, reason: 'malformed' }

  let value: unknown
  try {
    value = JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    return { ok: false, reason: 'malformed' }
  }

  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, reason: 'invalid_payload' }
  }
  const record = value as Record<string, unknown>
  const room = record.room
  const id = record.id
  const exp = record.exp
  if (record.v !== RELAY_GRANT_VERSION) return { ok: false, reason: 'invalid_payload' }
  if (typeof room !== 'string' || room.length === 0) return { ok: false, reason: 'invalid_payload' }
  if (record.role !== 'client') return { ok: false, reason: 'invalid_payload' }
  if (typeof id !== 'string' || id.length === 0 || id.length > RELAY_GRANT_MAX_ID_LENGTH) {
    return { ok: false, reason: 'invalid_payload' }
  }
  if (typeof exp !== 'number' || !Number.isSafeInteger(exp) || exp <= 0) {
    return { ok: false, reason: 'invalid_payload' }
  }
  return { ok: true, payload: { v: RELAY_GRANT_VERSION, room, role: 'client', id, exp } }
}

function validatePayload(payload: RelayGrantPayload): string | null {
  if (payload.v !== RELAY_GRANT_VERSION) return 'unsupported version'
  if (typeof payload.room !== 'string' || payload.room.length === 0) return 'missing room'
  if (payload.role !== 'client') return 'invalid role'
  if (
    typeof payload.id !== 'string' ||
    payload.id.length === 0 ||
    payload.id.length > RELAY_GRANT_MAX_ID_LENGTH
  ) {
    return 'invalid id'
  }
  if (!Number.isSafeInteger(payload.exp) || payload.exp <= 0) return 'invalid expiry'
  return null
}

async function hmacSign(agentToken: string, message: string): Promise<string> {
  const subtle = getCrypto().subtle
  const key = await subtle.importKey(
    'raw',
    utf8(agentToken),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const signature = await subtle.sign('HMAC', key, utf8(message))
  return bytesToBase64Url(new Uint8Array(signature))
}

const BASE64URL = /^[A-Za-z0-9_-]+$/

function bytesToBase64Url(bytes: Uint8Array<ArrayBufferLike>): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> | null {
  if (!BASE64URL.test(value)) return null
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

function equalBytes(
  left: Uint8Array<ArrayBufferLike>,
  right: Uint8Array<ArrayBufferLike>
): boolean {
  if (left.length !== right.length) return false
  let difference = 0
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index]
  return difference === 0
}

function utf8(value: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(new TextEncoder().encode(value))
}

function getCrypto(): Crypto {
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    throw new Error('WebCrypto is not available in this runtime')
  }
  return crypto
}
