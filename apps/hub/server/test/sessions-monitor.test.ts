import { describe, expect, it } from 'vitest'
import type { ClaraSession } from '@clara/api-contract'
import type { PanelSessionsQuery } from '@clara/shared-types'
import type { HarnessManager } from '../src/harness/manager.ts'
import type { HarnessConnection } from '../src/harness/types.ts'
import { SessionMonitor } from '../src/sessions/monitor.ts'

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function connection(harnessID: string, online: boolean, createdAt: number): HarnessConnection {
  return {
    id: `connection-${harnessID}`,
    harnessId: harnessID,
    kind: harnessID === 'harness-b' ? 'claude' : 'opencode',
    label: harnessID.toUpperCase(),
    transport: 'local',
    online,
    capabilities: {},
    credentialConfigured: true,
    createdAt,
    updatedAt: 1,
  }
}

type SessionOptions = {
  created?: number
  updated?: number
  archived?: number
  snoozed?: boolean
  agent?: string
  title?: string
}

function session(id: string, options: SessionOptions = {}): ClaraSession {
  return {
    id,
    projectID: 'p_demo',
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: {
      created: options.created ?? 1,
      updated: options.updated ?? options.created ?? 1,
      ...(options.archived !== undefined ? { archived: options.archived } : {}),
    },
    ...(options.snoozed ? { metadata: { snoozed: true } } : {}),
    ...(options.agent ? { agent: options.agent } : {}),
    ...(options.title ? { title: options.title } : {}),
    location: { directory: `/workspace/${id}` },
  }
}

function fakeHarness(
  options: {
    aSessions?: ClaraSession[]
    bSessions?: ClaraSession[]
    activeA?: Record<string, { type: 'running' }>
    activeB?: Record<string, { type: 'running' }>
    permissionsA?: Array<{ id: string; sessionID: string; action: string; resources: string[] }>
    failActiveA?: boolean
  } = {}
): { harness: HarnessManager; calls: string[] } {
  const calls: string[] = []
  const connections = [
    connection('harness-a', true, 2),
    connection('harness-b', true, 1),
    connection('harness-c', false, 3),
  ]
  const aSessions = options.aSessions ?? [
    session('a1', { created: 10, updated: 30, title: 'Fix parser', agent: 'build' }),
    session('a2', { created: 20, updated: 20 }),
    session('a3', { created: 30, updated: 10, archived: 5 }),
    session('a4', { created: 40, updated: 15, snoozed: true }),
  ]
  const bSessions = options.bSessions ?? [
    session('b1', { created: 5, updated: 25, title: 'Review docs', agent: 'plan' }),
    session('b2', { created: 15, updated: 12 }),
  ]
  const harness = {
    configured: true,
    generation: 1,
    active: connections[0],
    list: () => connections,
    overlaySession: (harnessID: string, value: ClaraSession): ClaraSession => ({
      ...value,
      projectID: harnessID === 'harness-b' ? 'p_other' : value.projectID,
    }),
    requestFor: async (
      harnessID: string,
      input: { path: string; search?: string }
    ): Promise<Response> => {
      calls.push(`${harnessID}:${input.path}`)
      if (harnessID === 'harness-a') {
        if (input.path === '/sessions/active') {
          if (options.failActiveA) return json({ message: 'active failed' }, 500)
          return json({
            data: options.activeA ?? { a1: { type: 'running' }, a5: { type: 'running' } },
          })
        }
        if (input.path === '/permissions') {
          return json({
            location: { directory: '/workspace/a1' },
            data: options.permissionsA ?? [],
          })
        }
        if (input.path === '/sessions') {
          return json({ data: aSessions, cursor: { previous: null, next: null } })
        }
        const match = /^\/sessions\/([^/]+)$/.exec(input.path)
        if (match) {
          if (match[1] === 'a5') {
            return json({ data: session('a5', { created: 2, updated: 18, title: 'Old runaway' }) })
          }
          return json({ message: 'not found' }, 404)
        }
      }
      if (harnessID === 'harness-b') {
        if (input.path === '/sessions/active') {
          return json({ data: options.activeB ?? {} })
        }
        if (input.path === '/permissions') {
          return json({
            location: { directory: '/workspace/b1' },
            data: [{ id: 'p1', sessionID: 'b1', action: 'bash', resources: [] }],
          })
        }
        if (input.path === '/sessions') {
          return json({ data: bSessions, cursor: { previous: null, next: null } })
        }
      }
      return json({ message: 'unknown request' }, 404)
    },
  } as unknown as HarnessManager
  return { harness, calls }
}

function monitor(harness: HarnessManager, canAccess = true): SessionMonitor {
  return new SessionMonitor({ harness, canAccess: () => canAccess })
}

describe('SessionMonitor', () => {
  it('merges every online harness and marks running and awaiting-input sessions', async () => {
    const { harness } = fakeHarness()
    const result = await monitor(harness).load()

    expect(result.sessions.map((row) => row.id).sort()).toEqual([
      'a1',
      'a2',
      'a4',
      'a5',
      'b1',
      'b2',
    ])
    expect(result.sessions.find((row) => row.id === 'a1')?.state).toBe('running')
    expect(result.sessions.find((row) => row.id === 'b1')?.state).toBe('awaiting-input')
    expect(result.sessions.find((row) => row.id === 'a2')?.state).toBe('idle')
    expect(result.sessions.find((row) => row.id === 'a5')?.title).toBe('Old runaway')
    expect(result.harnesses.map((harness) => harness.harnessID)).toEqual([
      'harness-b',
      'harness-a',
      'harness-c',
    ])
    expect(result.harnesses.find((harness) => harness.harnessID === 'harness-c')).toMatchObject({
      ok: false,
      code: 'offline',
    })
  })

  it('hides archived sessions by default and includes them on request', async () => {
    const { harness } = fakeHarness()
    const service = monitor(harness)

    const hidden = await service.load()
    expect(hidden.sessions.some((row) => row.id === 'a3')).toBe(false)

    const shown = await service.load({ includeArchived: true })
    expect(shown.sessions.find((row) => row.id === 'a3')?.archived).toBe(true)
  })

  it('filters by running state, harness, and search text', async () => {
    const { harness } = fakeHarness()
    const service = monitor(harness)

    const running = await service.load({ runningOnly: true })
    expect(running.sessions.map((row) => row.id).sort()).toEqual(['a1', 'a5'])

    const harnessA = await service.load({ harnessID: 'harness-a' })
    expect(new Set(harnessA.sessions.map((row) => row.harnessID))).toEqual(new Set(['harness-a']))
    expect(harnessA.harnesses).toHaveLength(1)

    const search = await service.load({ search: 'review' })
    expect(search.sessions.map((row) => row.id)).toEqual(['b1'])
  })

  it('keeps rows when the active lookup fails and reports a partial harness', async () => {
    const { harness } = fakeHarness({ failActiveA: true })
    const result = await monitor(harness).load({ harnessID: 'harness-a' })

    expect(result.sessions.some((row) => row.id === 'a1')).toBe(true)
    expect(result.sessions.every((row) => row.state === 'idle')).toBe(true)
    expect(result.harnesses[0]).toMatchObject({ ok: false, code: 'partial' })
  })

  it('returns disabled statuses without contacting a harness', async () => {
    const { harness, calls } = fakeHarness()
    const result = await monitor(harness, false).load()

    expect(result.sessions).toEqual([])
    expect(result.harnesses.every((harness) => harness.code === 'disabled')).toBe(true)
    expect(calls).toEqual([])
  })

  it('looks up an active session missing from the newest page', async () => {
    const { harness, calls } = fakeHarness()
    const result = await monitor(harness).load()

    expect(calls).toContain('harness-a:/sessions/a5')
    expect(result.sessions.find((row) => row.id === 'a5')).toMatchObject({
      state: 'running',
      title: 'Old runaway',
    })
  })

  it('rejects invalid harness payloads instead of returning partial rows', async () => {
    const harness = {
      list: () => [connection('harness-a', true, 1)],
      requestFor: async () => json({ data: [{ id: 'missing-time' }] }),
      overlaySession: (_harnessID: string, value: ClaraSession) => value,
    } as unknown as HarnessManager

    const result = await monitor(harness).load()
    expect(result.sessions).toEqual([])
    expect(result.harnesses[0]).toMatchObject({ ok: false, code: 'upstream_error' })
  })
})

// Keep the query type exercised so a field rename fails here as well as in the UI.
const query: PanelSessionsQuery = { harnessID: 'harness-a', runningOnly: true, limit: 50 }
void query
