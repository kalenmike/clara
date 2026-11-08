import { describe, expect, it } from 'vitest'
import { formatTokens } from './format'

describe('formatTokens', () => {
  it('shows zero for missing or zero usage', () => {
    expect(formatTokens(undefined)).toBe('0')
    expect(formatTokens(0)).toBe('0')
  })

  it('compacts thousands and millions', () => {
    expect(formatTokens(999)).toBe('999')
    expect(formatTokens(1_200)).toBe('1.2K')
    expect(formatTokens(1_250_000)).toBe('1.3M')
  })
})
