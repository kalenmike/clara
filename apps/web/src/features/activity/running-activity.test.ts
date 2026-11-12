import { describe, expect, it } from 'vitest'
import type { ClaraActivityHarness, ClaraRunningSession, ClaraSession } from '@clara/api-contract'
import { groupRunningSessions, runningSessionPath, sumRunningUsage } from './running-activity'

const harness = (harnessID: string, active = false): ClaraActivityHarness => ({
  harnessID,
  kind: 'opencode',
  label: harnessID,
  online: true,
  active,
  ok: true,
})

const running = (harnessID: string, sessionID: string, updated = 2): ClaraRunningSession => ({
  harnessID,
  session: {
    id: sessionID,
    projectID: 'p1',
    cost: 0.25,
    tokens: { input: 100, output: 20, reasoning: 5, cache: { read: 7, write: 3 } },
    time: { created: 1, updated },
    location: { directory: '/workspace/demo' },
  } satisfies ClaraSession,
})

describe('running activity helpers', () => {
  it('groups sessions by paired harness and keeps idle harnesses separate', () => {
    const result = groupRunningSessions(
      [running('a', 's1'), running('a', 's2'), running('b', 's3')],
      [harness('a'), harness('b'), harness('c')]
    )

    expect(result.groups.map((group) => group.harness.harnessID)).toEqual(['a', 'b'])
    expect(result.groups[0]?.sessions.map((item) => item.session.id)).toEqual(['s1', 's2'])
    expect(result.idle.map((item) => item.harnessID)).toEqual(['c'])
  })

  it('sums token categories and reported cost', () => {
    const totals = sumRunningUsage([running('a', 's1'), running('b', 's2')])

    expect(totals).toMatchObject({
      sessions: 2,
      harnesses: 2,
      input: 200,
      output: 40,
      reasoning: 10,
      cacheRead: 14,
      cacheWrite: 6,
      tokens: 270,
      cost: 0.5,
    })
  })

  it('only links sessions on the active harness with a known project', () => {
    const item = running('a', 's1')
    expect(runningSessionPath(item, harness('a', true), new Set(['p1']))).toBe('/p/p1/s/s1')
    expect(runningSessionPath(item, harness('a', false), new Set(['p1']))).toBeNull()
    expect(runningSessionPath(item, harness('a', true), new Set(['p2']))).toBeNull()
  })
})
