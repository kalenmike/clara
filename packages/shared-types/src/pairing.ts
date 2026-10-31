import { PROTOCOL_VERSION } from './protocol.ts'

export const PAIRING_HASH_KEY = 'pair'
export const PAIRING_CODE_PREFIX = 'clara1_'

export type PairingPayload = {
  v: typeof PROTOCOL_VERSION
  wsUrl: string
  room: string
  clientToken: string
  psk: string
  fingerprint: string
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
  const psk = typeof record.psk === 'string' ? record.psk.trim() : ''
  const fingerprint = typeof record.fingerprint === 'string' ? record.fingerprint.trim() : ''
  if (!room || !clientToken || !psk || !fingerprint) return null

  return { v: PROTOCOL_VERSION, wsUrl, room, clientToken, psk, fingerprint }
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
