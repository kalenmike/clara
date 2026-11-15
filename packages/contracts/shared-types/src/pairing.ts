import { PROTOCOL_VERSION } from './protocol.ts'

export const PAIRING_HASH_KEY = 'pair'
export const PAIRING_CODE_PREFIX = 'clara1_'
export const HARNESS_PAIRING_CODE_PREFIX = 'clara-harness1_'

/**
 * The pairing link is rendered as a QR and read by a phone camera at the sizes
 * the panel and the terminal can show. A relay link carries a one-time
 * enrollment grant and already uses most of this budget; a field that pushes
 * it further makes the code too dense to scan. The guard test fails the build
 * before that reaches a host.
 */
export const PAIRING_LINK_MAX_LENGTH = 768

/**
 * The desktop client registers this protocol. A hub page can hand an adapter
 * pairing code to the client without the person copying the code by hand.
 */
export const ADAPTER_LINK_PROTOCOL = 'clara'
export const ADAPTER_LINK_HOST = 'adapter'

export function buildAdapterInstallLink(code: string, kind?: string): string {
  const params = new URLSearchParams({ code })
  if (kind) params.set('kind', kind)
  return `${ADAPTER_LINK_PROTOCOL}://${ADAPTER_LINK_HOST}?${params.toString()}`
}

/** The adapter kind carried by a link, when present. */
export function parseAdapterInstallKind(input: string): string | null {
  const value = input.trim()
  if (!value.toLowerCase().startsWith(`${ADAPTER_LINK_PROTOCOL}://`)) return null
  try {
    const url = new URL(value)
    if (url.hostname !== ADAPTER_LINK_HOST) return null
    return url.searchParams.get('kind')?.trim() || null
  } catch {
    return null
  }
}

/** Read the code from a `clara://adapter?code=…` link, or return null. */
export function parseAdapterInstallLink(input: string): string | null {
  const value = input.trim()
  if (!value.toLowerCase().startsWith(`${ADAPTER_LINK_PROTOCOL}://`)) return null
  try {
    const url = new URL(value)
    if (url.hostname !== ADAPTER_LINK_HOST) return null
    const code = url.searchParams.get('code')?.trim()
    return code || null
  } catch {
    return null
  }
}

/**
 * A pairing link carries a one-time enrollment capability, not a long-lived
 * key. The enrollment token is used as the session key for the enrollment
 * handshake and is consumed by the hub after one device enrolls.
 */
export type PairingPayload = {
  v: typeof PROTOCOL_VERSION
  wsUrl: string
  room: string
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
  const enrollId = typeof record.enrollId === 'string' ? record.enrollId.trim() : ''
  const enrollToken = typeof record.enrollToken === 'string' ? record.enrollToken.trim() : ''
  const grant = typeof record.grant === 'string' ? record.grant.trim() : ''
  const fingerprint = typeof record.fingerprint === 'string' ? record.fingerprint.trim() : ''
  const expiresAt =
    typeof record.expiresAt === 'number' && Number.isSafeInteger(record.expiresAt)
      ? record.expiresAt
      : 0
  if (!room || !enrollId || !enrollToken || !fingerprint || expiresAt <= 0) return null
  // A relay code must carry the one-time enrollment grant the Worker checks
  // before upgrading. A local code runs over the hub's own listener and needs
  // none.
  if (room !== 'local' && !grant) return null

  return {
    v: PROTOCOL_VERSION,
    wsUrl,
    room,
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
  const linked = parseAdapterInstallLink(value)
  if (linked) return decodeHarnessPairingCode(linked)
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
  const enrollId = typeof record.enrollId === 'string' ? record.enrollId.trim() : ''
  const enrollToken = typeof record.enrollToken === 'string' ? record.enrollToken.trim() : ''
  const grant = typeof record.grant === 'string' ? record.grant.trim() : ''
  const fingerprint = typeof record.fingerprint === 'string' ? record.fingerprint.trim() : ''
  const expiresAt =
    typeof record.expiresAt === 'number' && Number.isSafeInteger(record.expiresAt)
      ? record.expiresAt
      : 0
  if (!kind || !room || !enrollId || !enrollToken || !fingerprint || expiresAt <= 0) {
    return null
  }
  if (room !== 'local' && !grant) return null

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
