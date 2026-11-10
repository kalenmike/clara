import { getCrypto, utf8 } from './codec.ts'
import { importSessionKey } from './keys.ts'

export type SessionKeys = {
  /** Browser client to home agent. */
  c2s: CryptoKey
  /** Home agent to browser client. */
  s2c: CryptoKey
}

export type SessionHandshake = {
  /** Raw device key or a non-extractable HKDF key held by the browser. */
  key: string | CryptoKey
  sid: string
  clientNonce: string
  agentNonce: string
}

/**
 * Derives independent keys for each direction from the device key and the
 * fresh connection nonces. A replayed handshake cannot produce the same keys
 * because the client nonce is generated per connection.
 */
export async function deriveSessionKeys(handshake: SessionHandshake): Promise<SessionKeys> {
  const { key, sid, clientNonce, agentNonce } = handshake
  const base = typeof key === 'string' ? await importSessionKey(key) : key
  const salt = await getCrypto().subtle.digest(
    'SHA-256',
    utf8(`clara/v2|${sid}|${clientNonce}|${agentNonce}`)
  )

  const [c2s, s2c] = await Promise.all([
    derive(base, salt, 'clara/v2/c2s'),
    derive(base, salt, 'clara/v2/s2c'),
  ])

  return { c2s, s2c }
}

async function derive(base: CryptoKey, salt: BufferSource, info: string): Promise<CryptoKey> {
  return getCrypto().subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt, info: utf8(info) },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}
