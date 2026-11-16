import { describe, expect, it } from 'vitest'
import { harnessHostSummary, type HarnessHost } from '../src/host.ts'

describe('harnessHostSummary', () => {
  it('returns the machine hostname for a local adapter', () => {
    expect(harnessHostSummary({ hostname: 'build-box', installMethod: 'local' })).toBe('build-box')
  })

  it('adds the install path for SSH and Docker', () => {
    expect(harnessHostSummary({ hostname: 'prod', installMethod: 'ssh' })).toBe('prod · SSH')
    expect(harnessHostSummary({ hostname: '3f2a1b', installMethod: 'docker' })).toBe(
      '3f2a1b · Docker'
    )
  })

  it('falls back to a container label when the hostname is missing', () => {
    expect(harnessHostSummary({ container: { runtime: 'docker' }, installMethod: 'docker' })).toBe(
      'container · Docker'
    )
  })

  it('returns undefined without a host report', () => {
    expect(harnessHostSummary(undefined)).toBeUndefined()
    expect(harnessHostSummary({} as HarnessHost)).toBeUndefined()
  })
})
