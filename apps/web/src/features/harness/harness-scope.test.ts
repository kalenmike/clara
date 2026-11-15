import { describe, expect, it } from 'vitest'
import { harnessLocation, resolveHarnessID } from './harness-scope'

describe('resolveHarnessID', () => {
  it('lets an explicit harness override the scope', () => {
    expect(resolveHarnessID('explicit', 'scope')).toBe('explicit')
  })

  it('falls back to the scope, then no harness', () => {
    expect(resolveHarnessID(undefined, 'scope')).toBe('scope')
    expect(resolveHarnessID(undefined, undefined)).toBeUndefined()
  })
})

describe('harnessLocation', () => {
  it('sends the harness only when one is known', () => {
    expect(harnessLocation('/repo', 'harness-one')).toEqual({
      location: { directory: '/repo' },
      harnessID: 'harness-one',
    })
    expect(harnessLocation('/repo', undefined)).toEqual({ location: { directory: '/repo' } })
  })
})
