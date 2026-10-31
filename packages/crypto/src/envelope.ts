import { base64UrlToBytes, bytesToBase64Url, getCrypto, randomBytes, utf8 } from './codec.ts'

const IV_BYTES = 12

export type EnvelopeDirection = 'c2s' | 's2c'

export type EnvelopeContext = {
  sid: string
  direction: EnvelopeDirection
  seq: number
}

export type SealedBox = {
  iv: string
  ct: string
}

export async function seal(
  key: CryptoKey,
  context: EnvelopeContext,
  plaintext: Uint8Array<ArrayBufferLike>
): Promise<SealedBox> {
  const iv = randomBytes(IV_BYTES)
  const ciphertext = await getCrypto().subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: buildAad(context) },
    key,
    new Uint8Array(plaintext)
  )
  return {
    iv: bytesToBase64Url(iv),
    ct: bytesToBase64Url(new Uint8Array(ciphertext)),
  }
}

export async function open(
  key: CryptoKey,
  context: EnvelopeContext,
  box: SealedBox
): Promise<Uint8Array<ArrayBuffer>> {
  const iv = base64UrlToBytes(box.iv)
  if (iv.length !== IV_BYTES) throw new Error('Sealed frame has an invalid nonce')
  const plaintext = await getCrypto().subtle.decrypt(
    { name: 'AES-GCM', iv, additionalData: buildAad(context) },
    key,
    base64UrlToBytes(box.ct)
  )
  return new Uint8Array(plaintext)
}

export function buildAad(context: EnvelopeContext): Uint8Array<ArrayBuffer> {
  return utf8(`clara/v1|${context.sid}|${context.direction}|${context.seq}`)
}
