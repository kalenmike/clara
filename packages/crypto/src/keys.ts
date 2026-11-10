import { base64UrlToBytes, bytesToBase64Url, getCrypto, randomBytes } from './codec.ts'

export const KEY_BYTES = 32
export const FINGERPRINT_BYTES = 8

/** Generates a 256-bit device key, encoded as base64url. */
export function generateKey(): string {
  return bytesToBase64Url(randomBytes(KEY_BYTES))
}

export function parseKey(key: string): Uint8Array<ArrayBuffer> {
  const bytes = base64UrlToBytes(key.trim())
  if (bytes.length !== KEY_BYTES) {
    throw new Error(`The device key must be ${KEY_BYTES} bytes`)
  }
  return bytes
}

/** Imports a device key as a non-extractable HKDF base key. */
export async function importSessionKey(key: string): Promise<CryptoKey> {
  return getCrypto().subtle.importKey('raw', parseKey(key), 'HKDF', false, ['deriveKey'])
}

/** A short, human-comparable identity for the key. */
export async function fingerprintKey(key: string): Promise<string> {
  const digest = await getCrypto().subtle.digest('SHA-256', parseKey(key))
  return bytesToBase64Url(new Uint8Array(digest).slice(0, FINGERPRINT_BYTES))
}
