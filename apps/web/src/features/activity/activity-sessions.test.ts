import { describe, expect, it } from 'vitest'
import type { ClaraActivityHarness, ClaraActivitySession, ClaraSession } from '@clara/api-contract'
import { activitySessionPath, groupActivitySessions, sumActivityUsage } from './activity-sessions'

const harness = (harnessID: string, createdAt: number, active = false): ClaraActivityHarness => ({
  harnessID,
  kind: 'opencode',
  label: harnessID,
  online: true,
  active,
  ok: true,
  createdAt,
})

const activity = (
  harnessID: string,
  sessionID: string,
  created = 1,
  mailbox: 'inbox' | 'outbox' = 'outbox'
): ClaraActivitySession => ({
  harnessID,
  mailbox,
  session: {
    id: sessionID,
    projectID: 'p1',
    cost: 0.25,
    tokens: { input: 100, output: 20, reasoning: 5, cache: { read: 7, write: 3 } },
    time: { created, updated: created },
    location: { directory: '/workspace/demo' },
  } satisfies ClaraSession,
})

describe('activity helpers', () => {
  it('groups sessions by paired harness and keeps idle harnesses separate', () => {
    const result = groupActivitySessions(
      [activity('a', 's2', 20), activity('a', 's1', 10), activity('b', 's3', 5)],
      [harness('a', 2), harness('b', 1), harness('c', 3)]
    )

    expect(result.groups.map((group) => group.harness.harnessID)).toEqual(['b', 'a'])
    expect(result.groups[0]?.sessions.map((item) => item.session.id)).toEqual(['s3'])
    expect(result.groups[1]?.sessions.map((item) => item.session.id)).toEqual(['s1', 's2'])
    expect(result.idle.map((item) => item.harnessID)).toEqual(['c'])
  })

  it('keeps the oldest session first so new cards append', () => {
    const result = groupActivitySessions(
      [activity('a', 'new', 30), activity('a', 'old', 10), activity('a', 'middle', 20)],
      [harness('a', 1)]
    )

    expect(result.groups[0]?.sessions.map((item) => item.session.id)).toEqual([
      'old',
      'middle',
      'new',
    ])
  })

  it('counts inbox and outbox sessions and sums tokens and reported cost', () => {
    const totals = sumActivityUsage([
      activity('a', 's1', 1, 'inbox'),
      activity('a', 's2', 2, 'outbox'),
      activity('b', 's3', 3, 'outbox'),
    ])

    expect(totals).toMatchObject({
      sessions: 3,
      harnesses: 2,
      inbox: 1,
      outbox: 2,
      input: 300,
      output: 60,
      reasoning: 15,
      cacheRead: 21,
      cacheWrite: 9,
      tokens: 405,
      cost: 0.75,
    })
  })

  it('links sessions that map to a Clara project regardless of harness activity', () => {
    const item = activity('a', 's1')
    expect(activitySessionPath(item, harness('a', 1, true), new Set(['p1']))).toBe('/p/p1/s/s1')
    expect(activitySessionPath(item, harness('a', 1, false), new Set(['p1']))).toBe('/p/p1/s/s1')
    expect(activitySessionPath(item, harness('a', 1, true), new Set(['p2']))).toBeNull()
    expect(activitySessionPath(item, undefined, new Set(['p1']))).toBeNull()
  })
})
