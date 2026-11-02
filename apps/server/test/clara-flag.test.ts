import { afterEach, describe, expect, it, vi } from 'vitest'
import { claraFeatureIncluded } from '../src/clara/flag.ts'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('claraFeatureIncluded', () => {
  it('is included by default', () => {
    vi.stubEnv('CLARA_MANAGEMENT', '')
    expect(claraFeatureIncluded()).toBe(true)
  })

  it('is excluded by the documented values', () => {
    for (const value of ['0', 'false', 'off', 'OFF']) {
      vi.stubEnv('CLARA_MANAGEMENT', value)
      expect(claraFeatureIncluded()).toBe(false)
    }
  })
})
