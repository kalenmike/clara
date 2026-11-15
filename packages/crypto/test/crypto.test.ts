import { describe, expect, it } from 'vitest'
import { ReplayGuard, fingerprintKey, generateKey, parseKey } from '../src/index.ts'

describe('device keys', () => {
  it('generates 32-byte keys', () => {
    expect(parseKey(generateKey())).toHaveLength(32)
  })

  it('rejects malformed keys', () => {
    expect(() => parseKey('too-short')).toThrow()
  })

  it('derives a stable fingerprint', async () => {
    const key = generateKey()
    const first = await fingerprintKey(key)
    const second = await fingerprintKey(key)
    expect(first).toBe(second)
    expect(first).not.toBe(await fingerprintKey(generateKey()))
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
