import { describe, expect, it } from 'vitest'
import {
  ReplayGuard,
  base64UrlToBytes,
  bytesToBase64Url,
  deriveSessionKeys,
  fingerprintPsk,
  generatePsk,
  open,
  parsePsk,
  seal,
  utf8,
} from '../src/index.ts'

const handshake = {
  psk: generatePsk(),
  sid: 'session-1',
  clientNonce: 'client-nonce',
  agentNonce: 'agent-nonce',
}

describe('pre-shared keys', () => {
  it('generates 32-byte keys', () => {
    expect(parsePsk(generatePsk())).toHaveLength(32)
  })

  it('rejects malformed keys', () => {
    expect(() => parsePsk('too-short')).toThrow()
  })

  it('derives a stable fingerprint', async () => {
    const first = await fingerprintPsk(handshake.psk)
    const second = await fingerprintPsk(handshake.psk)
    expect(first).toBe(second)
    expect(first).not.toBe(await fingerprintPsk(generatePsk()))
  })
})

describe('session keys', () => {
  it('round-trips a sealed frame', async () => {
    const keys = await deriveSessionKeys(handshake)
    const context = { sid: handshake.sid, direction: 'c2s' as const, seq: 0 }
    const box = await seal(keys.c2s, context, utf8('hello'))
    expect(new TextDecoder().decode(await open(keys.c2s, context, box))).toBe('hello')
  })

  it('uses different keys per direction', async () => {
    const keys = await deriveSessionKeys(handshake)
    const context = { sid: handshake.sid, direction: 'c2s' as const, seq: 0 }
    const box = await seal(keys.c2s, context, utf8('hello'))
    await expect(open(keys.s2c, context, box)).rejects.toThrow()
  })

  it('rejects a different pre-shared key', async () => {
    const keys = await deriveSessionKeys(handshake)
    const other = await deriveSessionKeys({ ...handshake, psk: generatePsk() })
    const context = { sid: handshake.sid, direction: 'c2s' as const, seq: 0 }
    const box = await seal(keys.c2s, context, utf8('hello'))
    await expect(open(other.c2s, context, box)).rejects.toThrow()
  })

  it('isolates sessions with different nonces', async () => {
    const keys = await deriveSessionKeys(handshake)
    const other = await deriveSessionKeys({ ...handshake, clientNonce: 'different' })
    const context = { sid: handshake.sid, direction: 'c2s' as const, seq: 0 }
    const box = await seal(keys.c2s, context, utf8('hello'))
    await expect(open(other.c2s, context, box)).rejects.toThrow()
  })

  it('rejects tampered ciphertext', async () => {
    const keys = await deriveSessionKeys(handshake)
    const context = { sid: handshake.sid, direction: 'c2s' as const, seq: 0 }
    const box = await seal(keys.c2s, context, utf8('hello'))
    const bytes = base64UrlToBytes(box.ct)
    bytes[0] ^= 1
    await expect(open(keys.c2s, context, { ...box, ct: bytesToBase64Url(bytes) })).rejects.toThrow()
  })

  it('binds the sequence number into the AAD', async () => {
    const keys = await deriveSessionKeys(handshake)
    const box = await seal(keys.c2s, { sid: handshake.sid, direction: 'c2s', seq: 0 }, utf8('a'))
    await expect(
      open(keys.c2s, { sid: handshake.sid, direction: 'c2s', seq: 1 }, box)
    ).rejects.toThrow()
  })
})

describe('replay guard', () => {
  it('accepts frames in order and rejects replays', () => {
    const guard = new ReplayGuard()
    guard.check(0)
    guard.check(1)
    expect(() => guard.check(1)).toThrow()
    expect(() => guard.check(3)).toThrow()
    expect(guard.expected).toBe(2)
  })
})
