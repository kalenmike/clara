import { describe, expect, it } from 'vitest'
import { parseVersion } from '../scripts/install.mjs'

describe('installer version parsing', () => {
  it('keeps dev build metadata', () => {
    expect(parseVersion('0.1.0-dev+abc1234 (21fec8d4, build 0123)')).toBe('0.1.0-dev+abc1234')
  })

  it('reads a release version', () => {
    expect(parseVersion('0.2.0 (abcdef12, build 4567)')).toBe('0.2.0')
  })

  it('rejects output without a version', () => {
    expect(parseVersion('no version here')).toBeUndefined()
  })
})
