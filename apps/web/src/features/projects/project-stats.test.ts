import { describe, expect, it } from 'vitest'
import type { ClaraSession, ClaraSessionsHarnessStatus } from '@clara/api-contract'
import { describePartialHarnesses, summarizeProjectSessions } from './project-stats'

function session(archived?: number): Pick<ClaraSession, 'time'> {
  return { time: { created: 0, updated: 0, archived } }
}

function harness(
  harnessID: string,
  options: { ok?: boolean; online?: boolean } = {}
): ClaraSessionsHarnessStatus {
  return {
    harnessID,
    label: harnessID,
    kind: 'opencode',
    online: options.online ?? true,
    ok: options.ok ?? true,
  }
}

describe('summarizeProjectSessions', () => {
  it('splits archived and non-archived sessions', () => {
    expect(summarizeProjectSessions([session(), session(10), session(20)])).toEqual({
      active: 1,
      archived: 2,
      total: 3,
      truncated: false,
      harnesses: [],
      partial: false,
    })
  })

  it('marks counts as truncated at the request limit', () => {
    expect(summarizeProjectSessions([session(), session(10)], [], 2)).toMatchObject({
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
      harnesses: [],
      partial: false,
    })
  })

  it('keeps per-harness statuses and stays complete when every harness answered', () => {
    const harnesses = [harness('alpha'), harness('beta')]

    expect(summarizeProjectSessions([session(), session(10)], harnesses)).toMatchObject({
      active: 1,
      archived: 1,
      total: 2,
      harnesses,
      partial: false,
    })
  })

  it('marks partial counts when a linked harness is offline or failed', () => {
    const harnesses = [
      harness('alpha'),
      harness('beta', { ok: false, online: false }),
      harness('gamma', { ok: false }),
    ]

    expect(summarizeProjectSessions([session(), session(10)], harnesses)).toMatchObject({
      active: 1,
      archived: 1,
      total: 2,
      harnesses,
      partial: true,
    })
  })
})

describe('describePartialHarnesses', () => {
  it('names only the harnesses that did not answer', () => {
    expect(describePartialHarnesses([harness('alpha'), harness('beta', { ok: false })])).toBe(
      'Counts exclude beta (failed)'
    )
    expect(
      describePartialHarnesses([
        harness('alpha', { ok: false, online: false }),
        harness('beta', { ok: false }),
      ])
    ).toBe('Counts exclude alpha (offline), beta (failed)')
  })

  it('has no description when every harness answered', () => {
    expect(describePartialHarnesses([harness('alpha')])).toBeUndefined()
    expect(describePartialHarnesses([])).toBeUndefined()
  })
})
