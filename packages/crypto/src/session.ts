import { getCrypto, utf8 } from './codec.ts'
import { fingerprintPsk, parsePsk } from './psk.ts'

export type SessionKeys = {
  /** Browser client to home agent. */
  c2s: CryptoKey
  /** Home agent to browser client. */
  s2c: CryptoKey
  fingerprint: string
}

export type SessionHandshake = {
  psk: string
  sid: string
  clientNonce: string
  agentNonce: string
}

/**
 * Derives independent keys for each direction from the pre-shared key and the
 * fresh connection nonces. A replayed handshake cannot produce the same keys
 * because the client nonce is generated per connection.
 */
export async function deriveSessionKeys(handshake: SessionHandshake): Promise<SessionKeys> {
  const { psk, sid, clientNonce, agentNonce } = handshake
  const base = await getCrypto().subtle.importKey('raw', parsePsk(psk), 'HKDF', false, [
    'deriveKey',
  ])
  const salt = await getCrypto().subtle.digest(
    'SHA-256',
    utf8(`clara/v1|${sid}|${clientNonce}|${agentNonce}`)
  )

  const [c2s, s2c, fingerprint] = await Promise.all([
    derive(base, salt, 'clara/v1/c2s'),
    derive(base, salt, 'clara/v1/s2c'),
    fingerprintPsk(psk),
  ])

  return { c2s, s2c, fingerprint }
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
