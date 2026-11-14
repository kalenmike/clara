import { PROTOCOL_VERSION } from './protocol.ts'

export const PAIRING_HASH_KEY = 'pair'
export const PAIRING_CODE_PREFIX = 'clara1_'
export const HARNESS_PAIRING_CODE_PREFIX = 'clara-harness1_'

/**
 * A pairing link carries a one-time enrollment capability, not a long-lived
 * key. The enrollment token is used as the session key for the enrollment
 * handshake and is consumed by the hub after one device enrolls.
 */
export type PairingPayload = {
  v: typeof PROTOCOL_VERSION
  wsUrl: string
  room: string
  /**
   * @deprecated The shared relay client token is replaced by `grant`. Kept
   * until the v4 cleanup lane removes it from the wire payload.
   */
  clientToken: string
  enrollId: string
  enrollToken: string
  /**
   * One-time enrollment grant presented to the relay as
   * `clara.auth.<grant>`. It is scoped to `enrollId` for ten minutes.
   */
  grant?: string
  /** Human-comparable fingerprint of the enrollment token. */
  fingerprint: string
  expiresAt: number
}

export function encodePairingCode(payload: PairingPayload): string {
  return bytesToBase64Url(new TextEncoder().encode(JSON.stringify(payload)))
}

export function decodePairingCode(code: string): PairingPayload | null {
  try {
    const raw = code.trim().replace(new RegExp(`^${PAIRING_CODE_PREFIX}`), '')
    const text = new TextDecoder().decode(base64UrlToBytes(raw))
    return validatePairing(JSON.parse(text))
  } catch {
    return null
  }
}

/** Accepts a full pairing URL, a `#pair=` URL, or a raw `clara1_` code. */
export function parsePairingInput(input: string): PairingPayload | null {
  const value = input.trim()
  if (!value) return null

  if (value.startsWith(PAIRING_CODE_PREFIX)) return decodePairingCode(value)

  if (value.startsWith('http://') || value.startsWith('https://')) {
    try {
      const url = new URL(value)
      const params = new URLSearchParams(url.hash.replace(/^#/, ''))
      const code = params.get(PAIRING_HASH_KEY)
      return code ? decodePairingCode(code) : null
    } catch {
      return null
    }
  }

  return decodePairingCode(value)
}

export function buildPairingUrl(baseUrl: string, payload: PairingPayload): string {
  const url = new URL(baseUrl)
  url.hash = `${PAIRING_HASH_KEY}=${encodePairingCode(payload)}`
  return url.toString()
}

export function validatePairing(value: unknown): PairingPayload | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (record.v !== PROTOCOL_VERSION) return null

  const wsUrl = typeof record.wsUrl === 'string' ? record.wsUrl.trim() : ''
  if (!wsUrl.startsWith('ws://') && !wsUrl.startsWith('wss://')) return null

  const room = typeof record.room === 'string' ? record.room.trim() : ''
  const clientToken = typeof record.clientToken === 'string' ? record.clientToken.trim() : ''
  const enrollId = typeof record.enrollId === 'string' ? record.enrollId.trim() : ''
  const enrollToken = typeof record.enrollToken === 'string' ? record.enrollToken.trim() : ''
  const grant = typeof record.grant === 'string' ? record.grant.trim() : ''
  const fingerprint = typeof record.fingerprint === 'string' ? record.fingerprint.trim() : ''
  const expiresAt =
    typeof record.expiresAt === 'number' && Number.isSafeInteger(record.expiresAt)
      ? record.expiresAt
      : 0
  if (!room || !clientToken || !enrollId || !enrollToken || !fingerprint || expiresAt <= 0) {
    return null
  }

  return {
    v: PROTOCOL_VERSION,
    wsUrl,
    room,
    clientToken,
    enrollId,
    enrollToken,
    ...(grant ? { grant } : {}),
    fingerprint,
    expiresAt,
  }
}

/**
 * A one-time code installed into a harness adapter. It carries the same
 * WebSocket enrollment capability as a browser code, plus the adapter role and
 * the harness kind.
 */
export type HarnessPairingPayload = {
  v: typeof PROTOCOL_VERSION
  role: 'adapter'
  kind: string
  wsUrl: string
  /** Additional workspace-side endpoints, for example a compose service name. */
  altWsUrls?: string[]
  room: string
  /**
   * @deprecated The shared relay client token is replaced by `grant`. Kept
   * until the v4 cleanup lane removes it from the wire payload.
   */
  clientToken: string
  enrollId: string
  enrollToken: string
  /** One-time enrollment grant scoped to `enrollId`. */
  grant?: string
  fingerprint: string
  expiresAt: number
}

export function encodeHarnessPairingCode(payload: HarnessPairingPayload): string {
  return bytesToBase64Url(new TextEncoder().encode(JSON.stringify(payload)))
}

export function decodeHarnessPairingCode(code: string): HarnessPairingPayload | null {
  try {
    const raw = code
      .trim()
      .replace(new RegExp(`^${HARNESS_PAIRING_CODE_PREFIX}`), '')
      .replace(new RegExp(`^${PAIRING_CODE_PREFIX}`), '')
    const text = new TextDecoder().decode(base64UrlToBytes(raw))
    return validateHarnessPairing(JSON.parse(text))
  } catch {
    return null
  }
}

export function parseHarnessPairingInput(input: string): HarnessPairingPayload | null {
  const value = input.trim()
  if (!value) return null
  if (value.startsWith(HARNESS_PAIRING_CODE_PREFIX)) return decodeHarnessPairingCode(value)
  if (value.startsWith(PAIRING_CODE_PREFIX)) return decodeHarnessPairingCode(value)
  if (value.startsWith('http://') || value.startsWith('https://')) {
    try {
      const url = new URL(value)
      const params = new URLSearchParams(url.hash.replace(/^#/, ''))
      const code = params.get(PAIRING_HASH_KEY)
      return code ? decodeHarnessPairingCode(code) : null
    } catch {
      return null
    }
  }
  return decodeHarnessPairingCode(value)
}

export function validateHarnessPairing(value: unknown): HarnessPairingPayload | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (record.v !== PROTOCOL_VERSION || record.role !== 'adapter') return null

  const wsUrl = typeof record.wsUrl === 'string' ? record.wsUrl.trim() : ''
  if (!wsUrl.startsWith('ws://') && !wsUrl.startsWith('wss://')) return null

  const kind = typeof record.kind === 'string' ? record.kind.trim() : ''
  const room = typeof record.room === 'string' ? record.room.trim() : ''
  const clientToken = typeof record.clientToken === 'string' ? record.clientToken.trim() : ''
  const enrollId = typeof record.enrollId === 'string' ? record.enrollId.trim() : ''
  const enrollToken = typeof record.enrollToken === 'string' ? record.enrollToken.trim() : ''
  const grant = typeof record.grant === 'string' ? record.grant.trim() : ''
  const fingerprint = typeof record.fingerprint === 'string' ? record.fingerprint.trim() : ''
  const expiresAt =
    typeof record.expiresAt === 'number' && Number.isSafeInteger(record.expiresAt)
      ? record.expiresAt
      : 0
  if (
    !kind ||
    !room ||
    !clientToken ||
    !enrollId ||
    !enrollToken ||
    !fingerprint ||
    expiresAt <= 0
  ) {
    return null
  }

  const altWsUrls = Array.isArray(record.altWsUrls)
    ? record.altWsUrls.filter(
        (item): item is string =>
          typeof item === 'string' && (item.startsWith('ws://') || item.startsWith('wss://'))
      )
    : undefined

  return {
    v: PROTOCOL_VERSION,
    role: 'adapter',
    kind,
    wsUrl,
    ...(altWsUrls && altWsUrls.length ? { altWsUrls } : {}),
    room,
    clientToken,
    enrollId,
    enrollToken,
    ...(grant ? { grant } : {}),
    fingerprint,
    expiresAt,
  }
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64UrlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}
