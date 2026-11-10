import { describe, expect, it } from 'vitest'
import {
  generateSecretKey,
  loadSecretKey,
  openSecret,
  parseSecretKey,
  sealSecret,
} from '../src/index.ts'

describe('secret storage', () => {
  it('generates 32-byte keys', () => {
    expect(parseSecretKey(generateSecretKey())).toHaveLength(32)
  })

  it('round-trips a secret with its AAD', async () => {
    const key = await loadSecretKey(generateSecretKey())
    const box = await sealSecret(key, 'harness:one:password', 'super-secret')
    expect(await openSecret(key, 'harness:one:password', box)).toBe('super-secret')
  })

  it('rejects another key or AAD', async () => {
    const key = await loadSecretKey(generateSecretKey())
    const other = await loadSecretKey(generateSecretKey())
    const box = await sealSecret(key, 'harness:one:password', 'super-secret')
    await expect(openSecret(other, 'harness:one:password', box)).rejects.toThrow()
    await expect(openSecret(key, 'harness:two:password', box)).rejects.toThrow()
  })

  it('rejects malformed keys', async () => {
    expect(() => parseSecretKey('too-short')).toThrow()
    await expect(loadSecretKey('too-short')).rejects.toThrow()
  })
})
