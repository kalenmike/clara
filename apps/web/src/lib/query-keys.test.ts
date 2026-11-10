import { describe, expect, it } from 'vitest'
import { queryKeys } from './query-keys'

describe('queryKeys project aggregates', () => {
  it('keeps presence and stats out of the session-list prefix', () => {
    expect(queryKeys.projectPresence('project')[0]).not.toBe('sessions')
    expect(queryKeys.projectStats('project')[0]).not.toBe('sessions')
  })
})
