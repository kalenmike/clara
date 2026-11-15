import { describe, expect, it } from 'vitest'
import {
  deriveV4SessionKeys,
  generateEphemeralKeyPair,
  generateKey,
  getCrypto,
  importSessionKey,
  open,
  seal,
  utf8,
  verifyV4HelloMac,
  type V4EphemeralKeyPair,
  type V4HandshakeInput,
} from '../src/index.ts'

type Setup = {
  staticKey: string
  client: V4EphemeralKeyPair
  hub: V4EphemeralKeyPair
  shared: Omit<V4HandshakeInput, 'privateKey' | 'peerPublicKey'>
}

async function setup(): Promise<Setup> {
  const staticKey = generateKey()
  const client = await generateEphemeralKeyPair()
  const hub = await generateEphemeralKeyPair()
  return {
    staticKey,
    client,
    hub,
    shared: {
      staticKey,
      sid: 'session-1',
      nonceC: 'client-nonce',
      nonceS: 'hub-nonce',
      ephC: client.publicKey,
      ephS: hub.publicKey,
    },
  }
}

function clientInput(value: Setup, overrides: Partial<V4HandshakeInput> = {}): V4HandshakeInput {
  return {
    ...value.shared,
    privateKey: value.client.privateKey,
    peerPublicKey: value.hub.publicKey,
    ...overrides,
  }
}

function hubInput(value: Setup, overrides: Partial<V4HandshakeInput> = {}): V4HandshakeInput {
  return {
    ...value.shared,
    privateKey: value.hub.privateKey,
    peerPublicKey: value.client.publicKey,
    ...overrides,
  }
}

const c2s = { sid: 'session-1', direction: 'c2s' as const, seq: 0 }
const s2c = { sid: 'session-1', direction: 's2c' as const, seq: 0 }

describe('v4 ephemeral keys', () => {
  it('generates distinct uncompressed P-256 points', async () => {
    const first = await generateEphemeralKeyPair()
    const second = await generateEphemeralKeyPair()
    for (const pair of [first, second]) {
      const bytes = base64UrlToBytes(pair.publicKey)
      expect(bytes).toHaveLength(65)
      expect(bytes[0]).toBe(0x04)
    }
    expect(first.publicKey).not.toBe(second.publicKey)
  })

  it('keeps the private key non-extractable', async () => {
    const pair = await generateEphemeralKeyPair()
    expect(pair.privateKey.extractable).toBe(false)
    await expect(getCrypto().subtle.exportKey('raw', pair.privateKey)).rejects.toThrow()
  })
})

describe('v4 key schedule', () => {
  it('derives identical directional keys and MAC on both sides', async () => {
    const value = await setup()
    const client = await deriveV4SessionKeys(clientInput(value))
    const hub = await deriveV4SessionKeys(hubInput(value))

    expect(client.mac).toBe(hub.mac)
    expect(client.mac).toMatch(/^[A-Za-z0-9_-]+$/)

    const request = await seal(client.keys.c2s, c2s, utf8('hello hub'))
    expect(new TextDecoder().decode(await open(hub.keys.c2s, c2s, request))).toBe('hello hub')

    const response = await seal(hub.keys.s2c, s2c, utf8('hello client'))
    expect(new TextDecoder().decode(await open(client.keys.s2c, s2c, response))).toBe(
      'hello client'
    )
  })

  it('accepts a non-extractable static key handle', async () => {
    const value = await setup()
    const raw = await deriveV4SessionKeys(clientInput(value))
    const handle = await importSessionKey(value.staticKey)
    const fromHandle = await deriveV4SessionKeys(clientInput(value, { staticKey: handle }))

    expect(fromHandle.mac).toBe(raw.mac)
    const box = await seal(raw.keys.c2s, c2s, utf8('same key'))
    expect(new TextDecoder().decode(await open(fromHandle.keys.c2s, c2s, box))).toBe('same key')
  })

  it('binds every transcript input', async () => {
    const value = await setup()
    const base = await deriveV4SessionKeys(clientInput(value))
    const variants: Partial<V4HandshakeInput>[] = [
      { sid: 'session-2' },
      { nonceC: 'other-client-nonce' },
      { nonceS: 'other-hub-nonce' },
      { ephC: value.hub.publicKey },
      { ephS: value.client.publicKey },
    ]

    for (const overrides of variants) {
      const other = await deriveV4SessionKeys(clientInput(value, overrides))
      expect(other.mac).not.toBe(base.mac)
      const box = await seal(base.keys.c2s, c2s, utf8('bound'))
      await expect(open(other.keys.c2s, c2s, box)).rejects.toThrow()
    }
  })

  it('cannot reopen a recorded session with the static key alone', async () => {
    // Forward-secrecy regression: an attacker who records the transcript and
    // later steals the static device key still lacks the discarded ephemeral
    // private key. Holding the transcript and static key but deriving with a
    // fresh ephemeral pair must not reproduce the recorded session keys.
    const value = await setup()
    const recorded = await deriveV4SessionKeys(clientInput(value))
    const box = await seal(recorded.keys.c2s, c2s, utf8('recorded payload'))

    const intruder = await generateEphemeralKeyPair()
    const intruderPeer = await generateEphemeralKeyPair()
    const attacked = await deriveV4SessionKeys({
      ...clientInput(value),
      privateKey: intruder.privateKey,
      peerPublicKey: intruderPeer.publicKey,
    })

    expect(attacked.mac).not.toBe(recorded.mac)
    await expect(open(attacked.keys.c2s, c2s, box)).rejects.toThrow()
  })

  it('rejects tampered ciphertext', async () => {
    const value = await setup()
    const keys = await deriveV4SessionKeys(clientInput(value))
    const box = await seal(keys.keys.c2s, c2s, utf8('hello'))
    const bytes = base64UrlToBytes(box.ct)
    bytes[0] ^= 1
    await expect(open(keys.keys.c2s, c2s, { ...box, ct: base64Url(bytes) })).rejects.toThrow()
  })

  it('binds the sequence number into the AAD', async () => {
    const value = await setup()
    const keys = await deriveV4SessionKeys(clientInput(value))
    const box = await seal(keys.keys.c2s, c2s, utf8('a'))
    await expect(open(keys.keys.c2s, { ...c2s, seq: c2s.seq + 1 }, box)).rejects.toThrow()
  })

  it('rejects a peer key that is not an uncompressed P-256 point', async () => {
    const value = await setup()
    await expect(
      deriveV4SessionKeys(clientInput(value, { peerPublicKey: base64Url(new Uint8Array(64)) }))
    ).rejects.toThrow()
  })
})

describe('v4 hello MAC', () => {
  it('verifies the matching transcript', async () => {
    const value = await setup()
    const material = await deriveV4SessionKeys(clientInput(value))
    await expect(verifyV4HelloMac({ ...clientInput(value), mac: material.mac })).resolves.toBe(true)
  })

  it('rejects a different static key', async () => {
    const value = await setup()
    const material = await deriveV4SessionKeys(clientInput(value))
    const wrong = await deriveV4SessionKeys(clientInput(value, { staticKey: generateKey() }))

    expect(wrong.mac).not.toBe(material.mac)
    await expect(
      verifyV4HelloMac({
        ...clientInput(value, { staticKey: generateKey() }),
        mac: material.mac,
      })
    ).resolves.toBe(false)
  })

  it('rejects a changed transcript and a malformed MAC', async () => {
    const value = await setup()
    const material = await deriveV4SessionKeys(clientInput(value))
    const tampered = flipFirstCharacter(material.mac)

    await expect(
      verifyV4HelloMac({ ...clientInput(value, { nonceS: 'other' }), mac: material.mac })
    ).resolves.toBe(false)
    await expect(verifyV4HelloMac({ ...clientInput(value), mac: tampered })).resolves.toBe(false)
    await expect(verifyV4HelloMac({ ...clientInput(value), mac: 'not base64!' })).resolves.toBe(
      false
    )
  })
})

function flipFirstCharacter(value: string): string {
  return (value[0] === 'A' ? 'B' : 'A') + value.slice(1)
}

function base64Url(bytes: Uint8Array): string {
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
