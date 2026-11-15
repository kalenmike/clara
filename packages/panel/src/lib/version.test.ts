import { describe, expect, it } from 'vitest'
import { displayVersion } from './version.ts'

describe('displayVersion', () => {
  it('appends the build commit to the package version', () => {
    expect(displayVersion('0.1.0', 'c8becb85')).toBe('0.1.0.c8becb85')
  })

  it('falls back to the package version without a commit', () => {
    expect(displayVersion('0.1.0', null)).toBe('0.1.0')
    expect(displayVersion('0.1.0', undefined)).toBe('0.1.0')
  })
})
