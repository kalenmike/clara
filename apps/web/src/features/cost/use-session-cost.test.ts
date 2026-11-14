import { describe, expect, it } from 'vitest'
import { costHarnessID } from './use-session-cost'

describe('costHarnessID', () => {
  it('prices a session with its own harness catalog', () => {
    expect(costHarnessID({ harnessID: 'harness-one' }, 'fallback')).toBe('harness-one')
  })

  it('falls back only when the session has no recorded harness', () => {
    expect(costHarnessID({}, 'fallback')).toBe('fallback')
    expect(costHarnessID(undefined)).toBeUndefined()
  })
})
