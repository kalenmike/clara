import { describe, expect, it } from 'vitest'
import type { ClaraSession } from '@clara/api-contract'
import type { ClaraClient } from '@/lib/client'
import { runWithConcurrency } from '@/lib/concurrency'
import {
  PROJECT_ACTION_CONCURRENCY,
  listAllProjectSessions,
  sessionsToArchive,
} from './use-project-actions'

function session(id: string, archived?: number): ClaraSession {
  return {
    id,
    time: { created: 0, updated: 0, ...(archived === undefined ? {} : { archived }) },
  } as ClaraSession
}

describe('sessionsToArchive', () => {
  it('skips sessions that are already archived', () => {
    expect(
      sessionsToArchive([session('a'), session('b', 10), session('c')]).map((s) => s.id)
    ).toEqual(['a', 'c'])
  })

  it('returns an empty list when everything is archived', () => {
    expect(sessionsToArchive([session('a', 10)])).toEqual([])
  })
})

describe('listAllProjectSessions', () => {
  it('follows every page and drops duplicate records', async () => {
    const pages: Record<string, ClaraSession[]> = {
      first: [session('a'), session('b')],
      second: [session('b'), session('c')],
    }
    const client = {
      session: {
        list: async ({ cursor }: { cursor?: string }) => {
          const key = cursor ?? 'first'
          return {
            data: pages[key] ?? [],
            cursor: key === 'first' ? { next: 'second' } : {},
          }
        },
      },
    } as unknown as ClaraClient

    const sessions = await listAllProjectSessions(client, 'project')

    expect(sessions.map((item) => item.id)).toEqual(['a', 'b', 'c'])
  })

  it('stops when the server repeats a cursor', async () => {
    let calls = 0
    const client = {
      session: {
        list: async () => {
          calls += 1
          return { data: [session('s1')], cursor: { next: 'same' } }
        },
      },
    } as unknown as ClaraClient

    const sessions = await listAllProjectSessions(client, 'project')

    expect(sessions.map((item) => item.id)).toEqual(['s1'])
    expect(calls).toBe(2)
  })
})

describe('runWithConcurrency', () => {
  it('runs every item without exceeding the worker limit', async () => {
    let active = 0
    let peak = 0
    const seen: number[] = []

    await runWithConcurrency([1, 2, 3, 4, 5], PROJECT_ACTION_CONCURRENCY, async (item) => {
      active += 1
      peak = Math.max(peak, active)
      await Promise.resolve()
      seen.push(item)
      active -= 1
    })

    expect(seen.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5])
    expect(peak).toBeLessThanOrEqual(PROJECT_ACTION_CONCURRENCY)
  })

  it('does nothing for an empty list', async () => {
    let calls = 0
    await runWithConcurrency([], PROJECT_ACTION_CONCURRENCY, async () => {
      calls += 1
    })
    expect(calls).toBe(0)
  })
})
