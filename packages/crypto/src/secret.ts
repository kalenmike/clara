import { base64UrlToBytes, bytesToBase64Url, getCrypto, randomBytes, utf8 } from './codec.ts'

export const SECRET_KEY_BYTES = 32
const SECRET_IV_BYTES = 12

/** A reversible secret stored at rest, never a password hash. */
export type SecretBox = {
  iv: string
  ct: string
}

export function generateSecretKey(): string {
  return bytesToBase64Url(randomBytes(SECRET_KEY_BYTES))
}

export function parseSecretKey(value: string): Uint8Array<ArrayBuffer> {
  const bytes = base64UrlToBytes(value.trim())
  if (bytes.length !== SECRET_KEY_BYTES) {
    throw new Error(`The secret key must be ${SECRET_KEY_BYTES} bytes`)
  }
  return bytes
}

/** Import a base64url secret key once and reuse it for every stored secret. */
export async function loadSecretKey(value: string): Promise<CryptoKey> {
  return getCrypto().subtle.importKey('raw', parseSecretKey(value), { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ])
}

export async function sealSecret(
  key: CryptoKey,
  aad: string,
  plaintext: string
): Promise<SecretBox> {
  const iv = randomBytes(SECRET_IV_BYTES)
  const ciphertext = await getCrypto().subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: utf8(aad) },
    key,
    utf8(plaintext)
  )
  return {
    iv: bytesToBase64Url(iv),
    ct: bytesToBase64Url(new Uint8Array(ciphertext)),
  }
}

export async function openSecret(key: CryptoKey, aad: string, box: SecretBox): Promise<string> {
  const iv = base64UrlToBytes(box.iv)
  if (iv.length !== SECRET_IV_BYTES) throw new Error('The stored secret has an invalid nonce')
  const plaintext = await getCrypto().subtle.decrypt(
    { name: 'AES-GCM', iv, additionalData: utf8(aad) },
    key,
    base64UrlToBytes(box.ct)
  )
  return new TextDecoder().decode(plaintext)
}
