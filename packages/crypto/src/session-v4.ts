import { base64UrlToBytes, bytesToBase64Url, equalBytes, getCrypto, utf8 } from './codec.ts'
import { importSessionKey } from './keys.ts'

const P256_PUBLIC_KEY_BYTES = 65
const P256_UNCOMPRESSED_PREFIX = 0x04
const V4_LABEL = 'clara/v4'

export type V4EphemeralKeyPair = {
  privateKey: CryptoKey
  /** Base64url raw uncompressed P-256 point. */
  publicKey: string
}

export type V4SessionKeys = {
  /** Client to hub. */
  c2s: CryptoKey
  /** Hub to client. */
  s2c: CryptoKey
}

export type V4HandshakeInput = {
  /**
   * The device key, enrollment token, or adapter credential as raw base64url
   * bytes, or the non-extractable HKDF key a browser holds in IndexedDB.
   */
  staticKey: string | CryptoKey
  sid: string
  /** Client hello nonce. */
  nonceC: string
  /** Hub hello nonce. */
  nonceS: string
  /** Client ephemeral public point, base64url. */
  ephC: string
  /** Hub ephemeral public point, base64url. */
  ephS: string
  /** This side's ephemeral private key. */
  privateKey: CryptoKey
  /** The peer's ephemeral public key or its base64url point. */
  peerPublicKey: CryptoKey | string
}

export type V4SessionMaterial = {
  keys: V4SessionKeys
  /** Base64url HMAC-SHA-256 over the v4 transcript. */
  mac: string
}

/**
 * Generates a fresh P-256 ECDH key pair per connection. The private key is
 * memory-only and discarded when the session ends; that discard is what gives
 * v4 forward secrecy. The key pair is extractable so the public point can be
 * exported, but the private key never leaves the process.
 */
export async function generateEphemeralKeyPair(): Promise<V4EphemeralKeyPair> {
  const pair = await getCrypto().subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ])
  const raw = new Uint8Array(await getCrypto().subtle.exportKey('raw', pair.publicKey))
  if (raw.length !== P256_PUBLIC_KEY_BYTES || raw[0] !== P256_UNCOMPRESSED_PREFIX) {
    throw new Error('The generated ephemeral key is not an uncompressed P-256 point')
  }
  return { privateKey: pair.privateKey, publicKey: bytesToBase64Url(raw) }
}

/**
 * Derives both directional AES-GCM keys and the hello MAC.
 *
 * The static key is the HKDF base key so it can stay non-extractable in a
 * browser. The ECDH secret goes into the SHA-256 salt instead of the base key:
 * a later static-key compromise cannot recover the ephemeral secrets, so it
 * cannot rebuild the salt or the session keys.
 */
export async function deriveV4SessionKeys(input: V4HandshakeInput): Promise<V4SessionMaterial> {
  const material = await deriveMaterial(input)
  return { keys: material.keys, mac: material.mac }
}

/**
 * Re-derives the transcript MAC and compares it with the hub hello in constant
 * time. Malformed inputs and a wrong static key both return false.
 */
export async function verifyV4HelloMac(
  input: V4HandshakeInput & { mac: string }
): Promise<boolean> {
  let expected: Uint8Array<ArrayBuffer>
  let presented: Uint8Array<ArrayBuffer>
  try {
    const material = await deriveMaterial(input)
    expected = base64UrlToBytes(material.mac)
    presented = base64UrlToBytes(input.mac)
  } catch {
    return false
  }
  return equalBytes(expected, presented)
}

async function deriveMaterial(input: V4HandshakeInput): Promise<{
  keys: V4SessionKeys
  mac: string
  macKey: CryptoKey
}> {
  const subtle = getCrypto().subtle
  const base =
    typeof input.staticKey === 'string' ? await importSessionKey(input.staticKey) : input.staticKey
  const peerPublicKey = await importPeerPublicKey(input.peerPublicKey)

  const ecdhe = new Uint8Array(
    await subtle.deriveBits({ name: 'ECDH', public: peerPublicKey }, input.privateKey, 256)
  )
  const transcript = buildTranscript(input)
  const salt = new Uint8Array(await subtle.digest('SHA-256', concatBytes(transcript, ecdhe)))

  const [c2s, s2c, macKey] = await Promise.all([
    deriveAesKey(base, salt, `${V4_LABEL}/c2s`),
    deriveAesKey(base, salt, `${V4_LABEL}/s2c`),
    deriveHmacKey(base, salt, `${V4_LABEL}/mac`),
  ])
  const signature = await subtle.sign('HMAC', macKey, transcript)

  return {
    keys: { c2s, s2c },
    mac: bytesToBase64Url(new Uint8Array(signature)),
    macKey,
  }
}

function buildTranscript(input: V4HandshakeInput): Uint8Array<ArrayBuffer> {
  return utf8(
    `${V4_LABEL}|${input.sid}|${input.nonceC}|${input.nonceS}|${input.ephC}|${input.ephS}`
  )
}

async function importPeerPublicKey(value: CryptoKey | string): Promise<CryptoKey> {
  if (typeof value !== 'string') return value
  const bytes = base64UrlToBytes(value)
  if (bytes.length !== P256_PUBLIC_KEY_BYTES || bytes[0] !== P256_UNCOMPRESSED_PREFIX) {
    throw new Error('The peer ephemeral key is not an uncompressed P-256 point')
  }
  return getCrypto().subtle.importKey(
    'raw',
    bytes,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  )
}

async function deriveAesKey(base: CryptoKey, salt: BufferSource, info: string): Promise<CryptoKey> {
  return getCrypto().subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt, info: utf8(info) },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}

async function deriveHmacKey(
  base: CryptoKey,
  salt: BufferSource,
  info: string
): Promise<CryptoKey> {
  return getCrypto().subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt, info: utf8(info) },
    base,
    { name: 'HMAC', hash: 'SHA-256', length: 256 },
    false,
    ['sign', 'verify']
  )
}

function concatBytes(...parts: Uint8Array<ArrayBufferLike>[]): Uint8Array<ArrayBuffer> {
  const length = parts.reduce((total, part) => total + part.length, 0)
  const result = new Uint8Array(length)
  let offset = 0
  for (const part of parts) {
    result.set(part, offset)
    offset += part.length
  }
  return result
}
