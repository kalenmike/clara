import { QueryClient } from '@tanstack/react-query'
import type { SessionInfo } from '@opencode/client'
import { describe, expect, it, vi } from 'vitest'
import type { ClaraClient } from '@/lib/client'
import { queryKeys } from '@/lib/query-keys'
import type { DeleteSessionsResult } from './use-delete-sessions'

function session(id: string, title = `Title ${id}`): SessionInfo {
  return { id, title, time: { created: 1, updated: 1 } } as SessionInfo
}

function clientWith(remove: (input: { sessionID: string }) => Promise<unknown>): ClaraClient {
  return { session: { remove } } as unknown as ClaraClient
}

async function deleteModule() {
  return import('./use-delete-sessions')
}

describe('deleteSessions', () => {
  it('continues after a rejection and reports deleted and failed sessions in input order', async () => {
    const { deleteSessions } = await deleteModule()
    const failure = new Error('cannot delete b')
    const remove = vi.fn(async ({ sessionID }: { sessionID: string }) => {
      if (sessionID === 'b') throw failure
    })
    const sessions = [session('a'), session('b'), session('c'), session('d')]

    const result = await deleteSessions(clientWith(remove), sessions)

    expect(result.deleted).toEqual(['a', 'c', 'd'])
    expect(result.failed.map((item) => item.session.id)).toEqual(['b'])
    expect(result.failed[0]?.error).toBe(failure)
  })

  it('calls the existing remove endpoint once per session with the session ID', async () => {
    const { deleteSessions } = await deleteModule()
    const remove = vi.fn(async () => undefined)
    const sessions = [session('a'), session('b')]

    await deleteSessions(clientWith(remove), sessions)

    expect(remove).toHaveBeenCalledTimes(2)
    expect(remove).toHaveBeenNthCalledWith(1, { sessionID: 'a' })
    expect(remove).toHaveBeenNthCalledWith(2, { sessionID: 'b' })
  })

  it('runs at most four removals at once', async () => {
    const { SESSION_DELETE_CONCURRENCY, deleteSessions } = await deleteModule()
    let active = 0
    let peak = 0
    const remove = vi.fn(async () => {
      active += 1
      peak = Math.max(peak, active)
      await new Promise((resolve) => setTimeout(resolve, 2))
      active -= 1
    })

    await deleteSessions(
      clientWith(remove),
      Array.from({ length: 9 }, (_, index) => session(`s-${index}`))
    )

    expect(SESSION_DELETE_CONCURRENCY).toBe(4)
    expect(peak).toBeLessThanOrEqual(4)
    expect(peak).toBeGreaterThan(1)
  })

  it('returns empty results for an empty selection without calling remove', async () => {
    const { deleteSessions } = await deleteModule()
    const remove = vi.fn(async () => undefined)

    const result = await deleteSessions(clientWith(remove), [])

    expect(result).toEqual({ deleted: [], failed: [] })
    expect(remove).not.toHaveBeenCalled()
  })

  it('keeps every session as a failure when all removals fail', async () => {
    const { deleteSessions } = await deleteModule()
    const remove = vi.fn(async () => {
      throw new Error('offline')
    })
    const sessions = [session('a'), session('b')]

    const result = await deleteSessions(clientWith(remove), sessions)

    expect(result.deleted).toEqual([])
    expect(result.failed.map((item) => item.session.id)).toEqual(['a', 'b'])
  })
})

describe('invalidateDeletedSessions', () => {
  it('invalidates the session list once and only successful individual session queries', async () => {
    const { invalidateDeletedSessions } = await deleteModule()
    const queryClient = new QueryClient()
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    const result: DeleteSessionsResult = {
      deleted: ['a', 'b'],
      failed: [{ session: session('c'), error: new Error('failed') }],
    }

    await invalidateDeletedSessions(queryClient, result)

    const calls = invalidate.mock.calls.map(
      ([filters]) => filters as { queryKey: readonly unknown[] }
    )
    const listCalls = calls.filter(
      (filters) => filters.queryKey.length === 1 && filters.queryKey[0] === 'sessions'
    )
    const sessionIDs = calls
      .filter((filters) => filters.queryKey[0] === 'session')
      .map((filters) => filters.queryKey[1])

    expect(listCalls).toHaveLength(1)
    expect(sessionIDs).toEqual(['a', 'b'])
    expect(calls.some((filters) => filters.queryKey[1] === 'c')).toBe(false)
    expect(calls).toContainEqual({ queryKey: queryKeys.session('a') })
    expect(calls).toContainEqual({ queryKey: queryKeys.session('b') })
  })
})

describe('describeFailedSessions', () => {
  it('uses the singular noun for blank titles', async () => {
    const { describeFailedSessions } = await deleteModule()

    const text = describeFailedSessions(
      [{ session: session('blank', '   '), error: new Error('failed') }],
      'brief'
    )

    expect(text).toContain('Untitled brief')
  })

  it('uses a custom singular noun for blank titles', async () => {
    const { describeFailedSessions } = await deleteModule()

    const text = describeFailedSessions(
      [{ session: session('blank', ''), error: new Error('failed') }],
      'task'
    )

    expect(text).toContain('Untitled task')
  })

  it('names one, two, and three sessions without a remainder', async () => {
    const { describeFailedSessions } = await deleteModule()
    const failures = ['Alpha', 'Beta', 'Gamma'].map((title) => ({
      session: session(title.toLowerCase(), title),
      error: new Error('failed'),
    }))

    expect(describeFailedSessions(failures.slice(0, 1), 'brief')).toBe('Alpha')
    expect(describeFailedSessions(failures.slice(0, 2), 'brief')).toBe('Alpha and Beta')
    expect(describeFailedSessions(failures, 'brief')).toBe('Alpha, Beta and Gamma')
  })

  it('names at most three sessions and appends the remaining count', async () => {
    const { describeFailedSessions } = await deleteModule()
    const failures = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon'].map((title) => ({
      session: session(title.toLowerCase(), title),
      error: new Error('failed'),
    }))

    const text = describeFailedSessions(failures, 'brief')

    expect(text).toContain('Alpha')
    expect(text).toContain('Beta')
    expect(text).toContain('Gamma')
    expect(text).not.toContain('Delta')
    expect(text).not.toContain('Epsilon')
    expect(text).toMatch(/and\s+2\s+more/i)
  })
})

describe('describeDeleteOutcome', () => {
  const wording = { lowerSingular: 'brief', lowerPlural: 'briefs' }

  it('returns null for an empty result', async () => {
    const { describeDeleteOutcome } = await deleteModule()

    expect(describeDeleteOutcome({ deleted: [], failed: [] }, wording)).toBeNull()
  })

  it('uses singular and plural success copy', async () => {
    const { describeDeleteOutcome } = await deleteModule()

    expect(describeDeleteOutcome({ deleted: ['a'], failed: [] }, wording)).toEqual({
      tone: 'success',
      title: 'Deleted 1 brief',
    })
    expect(describeDeleteOutcome({ deleted: ['a', 'b'], failed: [] }, wording)).toEqual({
      tone: 'success',
      title: 'Deleted 2 briefs',
    })
  })

  it('describes a partial failure with both counts', async () => {
    const { describeDeleteOutcome } = await deleteModule()

    const copy = describeDeleteOutcome(
      {
        deleted: ['a', 'c'],
        failed: [{ session: session('b', 'Beta'), error: new Error('failed') }],
      },
      wording
    )

    expect(copy).toEqual({
      tone: 'error',
      title: 'Deleted 2 briefs and failed to delete 1 brief',
      description: 'Beta',
    })
  })

  it('never says Deleted 0 when every write fails', async () => {
    const { describeDeleteOutcome } = await deleteModule()

    const copy = describeDeleteOutcome(
      {
        deleted: [],
        failed: [
          { session: session('a', 'Alpha'), error: new Error('failed') },
          { session: session('b', 'Beta'), error: new Error('failed') },
        ],
      },
      wording
    )

    expect(copy?.tone).toBe('error')
    expect(copy?.title).toBe('Could not delete 2 briefs')
    expect(copy?.title).not.toContain('Deleted 0')
    expect(copy?.description).toBe('Alpha and Beta')
  })

  it('uses the singular noun when one session fails', async () => {
    const { describeDeleteOutcome } = await deleteModule()

    const copy = describeDeleteOutcome(
      { deleted: [], failed: [{ session: session('a', 'Alpha'), error: new Error('failed') }] },
      { lowerSingular: 'task', lowerPlural: 'tasks' }
    )

    expect(copy?.title).toBe('Could not delete 1 task')
  })
})
