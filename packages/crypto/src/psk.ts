import { base64UrlToBytes, bytesToBase64Url, getCrypto, randomBytes } from './codec.ts'

export const PSK_BYTES = 32
export const FINGERPRINT_BYTES = 8

/** Generates a 256-bit pre-shared key, encoded as base64url. */
export function generatePsk(): string {
  return bytesToBase64Url(randomBytes(PSK_BYTES))
}

export function parsePsk(psk: string): Uint8Array<ArrayBuffer> {
  const bytes = base64UrlToBytes(psk.trim())
  if (bytes.length !== PSK_BYTES) {
    throw new Error(`The pairing key must be ${PSK_BYTES} bytes`)
  }
  return bytes
}

/** A short, human-comparable identity for the key. */
export async function fingerprintPsk(psk: string): Promise<string> {
  const digest = await getCrypto().subtle.digest('SHA-256', parsePsk(psk))
  return bytesToBase64Url(new Uint8Array(digest).slice(0, FINGERPRINT_BYTES))
}
