import { describe, expect, it } from 'vitest'
import type { ClaraSession } from '@clara/api-contract'
import { summarizeProjectSessions } from './project-stats'

function session(archived?: number): Pick<ClaraSession, 'time'> {
  return { time: { created: 0, updated: 0, archived } }
}

describe('summarizeProjectSessions', () => {
  it('splits archived and non-archived sessions', () => {
    expect(summarizeProjectSessions([session(), session(10), session(20)])).toEqual({
      active: 1,
      archived: 2,
      total: 3,
      truncated: false,
    })
  })

  it('marks counts as truncated at the request limit', () => {
    expect(summarizeProjectSessions([session(), session(10)], 2)).toMatchObject({
      total: 2,
      truncated: true,
    })
  })

  it('handles an empty list', () => {
    expect(summarizeProjectSessions([])).toEqual({
      active: 0,
      archived: 0,
      total: 0,
      truncated: false,
    })
  })
})
