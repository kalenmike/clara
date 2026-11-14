import { describe, expect, it } from 'vitest'
import type { ClaraSession } from '@clara/api-contract'
import { createApiApp } from '../src/api/app.ts'
import type { ApiDependencies } from '../src/api/context.ts'
import { decodeMergedSessionCursor } from '../src/api/session-pages.ts'
import type { HarnessManager } from '../src/harness/manager.ts'
import {
  HarnessOfflineError,
  type HarnessConnection,
  type HarnessRequestInput,
} from '../src/harness/types.ts'
import type { ProjectStore, WorkspaceState } from '../src/projects/store.ts'

type LinkRow = {
  harness_id: string
  harness_project_id: string
  project_id: string
  workspace_id: string | null
  last_seen_at: number
}

type RecordedRequest = {
  harnessID: string
  method: string
  path: string
  search: URLSearchParams
  body?: unknown
}

type MetadataCalls = {
  archived: Array<[string, string, boolean]>
  snoozed: Array<[string, string, boolean]>
  viewed: Array<[string, string]>
  titles: Array<[string, string, string | undefined]>
}

type FixtureOptions = {
  active?: string
  connections?: string[]
  offline?: string[]
  links?: Record<string, Array<[harnessID: string, harnessProjectID: string]>>
  sessions?: Record<string, ClaraSession[]>
  failing?: Array<[harnessID: string, harnessProjectID: string]>
  workspaces?: Array<{ harnessID: string; directory: string }>
}

type Fixture = {
  harness: HarnessManager
  requests: RecordedRequest[]
  metadata: MetadataCalls
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function session(id: string, projectID: string, updated: number): ClaraSession {
  return {
    id,
    projectID,
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 1, updated },
    location: { directory: '/workspace/demo' },
  }
}

function fixture(options: FixtureOptions = {}): Fixture {
  const activeID = options.active ?? 'harness-a'
  const ids = options.connections ?? ['harness-a', 'harness-b']
  const offline = new Set(options.offline ?? [])
  const requests: RecordedRequest[] = []
  const metadata: MetadataCalls = { archived: [], snoozed: [], viewed: [], titles: [] }
  const links = options.links ?? {}
  const sessions = options.sessions ?? {}
  const failing = new Set(
    (options.failing ?? []).map(([harnessID, projectID]) => `${harnessID}:${projectID}`)
  )
  const workspaces = options.workspaces ?? []

  const connections: HarnessConnection[] = ids.map((harnessID) => ({
    id: `connection-${harnessID}`,
    harnessId: harnessID,
    kind: 'opencode',
    label: `Harness ${harnessID}`,
    transport: 'local',
    online: !offline.has(harnessID),
    capabilities: {},
    isActive: harnessID === activeID,
    credentialConfigured: true,
    createdAt: 1,
    updatedAt: 1,
  }))
  const active = connections.find((connection) => connection.harnessId === activeID)

  const sessionHarness = new Map<string, string>()
  for (const [key, items] of Object.entries(sessions)) {
    const harnessID = key.split(':')[0] ?? ''
    for (const item of items) sessionHarness.set(item.id, harnessID)
  }

  const projectStore = {
    list: () => [],
    get: () => undefined,
    linksForProject: (projectID: string): LinkRow[] =>
      (links[projectID] ?? []).map(([harnessID, harnessProjectID]) => ({
        harness_id: harnessID,
        harness_project_id: harnessProjectID,
        project_id: projectID,
        workspace_id: null,
        last_seen_at: 1,
      })),
    workspacesForDirectory: (directory: string): WorkspaceState[] =>
      workspaces
        .filter((workspace) => workspace.directory === directory)
        .map((workspace) => ({
          id: `workspace-${workspace.harnessID}`,
          projectID: 'p_demo',
          harnessID: workspace.harnessID,
          directory: workspace.directory,
          canonical: workspace.directory,
          createdAt: 1,
          updatedAt: 1,
        })),
  } as unknown as ProjectStore

  const findSession = (harnessID: string, sessionID: string): ClaraSession | undefined => {
    for (const [key, items] of Object.entries(sessions)) {
      if (!key.startsWith(`${harnessID}:`)) continue
      const found = items.find((item) => item.id === sessionID)
      if (found) return found
    }
    return undefined
  }

  const harness = {
    configured: true,
    generation: 1,
    active,
    lastError: undefined,
    harnessId: active?.harnessId,
    list: () => connections,
    connection: (harnessID: string) =>
      connections.find((connection) => connection.harnessId === harnessID),
    projects: projectStore,
    metadata: {
      harnessIdForSession: (sessionID: string) => sessionHarness.get(sessionID),
      setArchived: (harnessID: string, sessionID: string, archived: boolean) =>
        metadata.archived.push([harnessID, sessionID, archived]),
      setSnoozed: (harnessID: string, sessionID: string, snoozed: boolean) =>
        metadata.snoozed.push([harnessID, sessionID, snoozed]),
      setViewed: (harnessID: string, sessionID: string) =>
        metadata.viewed.push([harnessID, sessionID]),
      setTitle: (harnessID: string, sessionID: string, title: string | undefined) =>
        metadata.titles.push([harnessID, sessionID, title]),
    },
    overlaySession: (harnessID: string, item: ClaraSession): ClaraSession => ({
      ...item,
      harnessID,
    }),
    overlaySessionList: (value: { data: ClaraSession[]; cursor: unknown }) => value,
    requestFor: async (harnessID: string, input: HarnessRequestInput): Promise<Response> => {
      const search = new URLSearchParams(input.search ?? '')
      requests.push({
        harnessID,
        method: input.method,
        path: input.path,
        search,
        ...(input.body === undefined ? {} : { body: JSON.parse(input.body) as unknown }),
      })
      const connection = connections.find((item) => item.harnessId === harnessID)
      if (!connection?.online) throw new HarnessOfflineError()
      return respond(harnessID, input, search, findSession, sessions, failing)
    },
  } as unknown as HarnessManager

  return { harness, requests, metadata }
}

function respond(
  harnessID: string,
  input: HarnessRequestInput,
  search: URLSearchParams,
  findSession: (harnessID: string, sessionID: string) => ClaraSession | undefined,
  sessions: Record<string, ClaraSession[]>,
  failing: Set<string>
): Response {
  if (input.path === '/sessions/active') {
    return json({ [`${harnessID}-running`]: { type: 'running' } })
  }
  if (input.path === '/sessions' && input.method === 'GET') {
    const projectID = search.get('project') ?? ''
    const key = `${harnessID}:${projectID}`
    if (failing.has(key)) {
      return json({ error: { code: 'record_failed', message: 'record failed' } }, 503)
    }
    return json({
      data: sessions[key] ?? [],
      cursor: { previous: null, next: `${key}-next` },
    })
  }
  if (input.path === '/sessions' && input.method === 'POST') {
    return json({ data: session(`created-${harnessID}`, 'project-created', 100) })
  }
  const match = /^\/sessions\/([^/]+)$/.exec(input.path)
  if (match && input.method === 'GET') {
    const found = findSession(harnessID, decodeURIComponent(match[1] ?? ''))
    if (found) return json({ data: found })
    return json({ error: { code: 'not_found', message: 'not found' } }, 404)
  }
  if (match && (input.method === 'PATCH' || input.method === 'DELETE')) {
    return new Response(null, { status: 204 })
  }
  if (input.path === '/worktrees') {
    const projectID = search.get('projectID') ?? ''
    return json([{ directory: '/workspace/demo', strategy: `${harnessID}:${projectID}` }])
  }
  if (input.path === '/worktrees/refresh') {
    return new Response(null, { status: 204 })
  }
  if (input.path === '/permissions') {
    const directory = search.get('directory') ?? '/workspace/demo'
    return json({ location: { directory }, data: [] })
  }
  if (input.path === '/locations') {
    const directory = search.get('directory') ?? ''
    return json({ directory, project: { id: 'project-a', directory, canonical: directory } })
  }
  return json({ error: { code: 'not_found', message: 'not found' } }, 404)
}

function createTestApi(harness: HarnessManager) {
  const deps: ApiDependencies = {
    harness,
    info: { version: '0.1.0', protocol: 1 },
    startedAt: 1000,
    canAccess: () => true,
    sessionCount: () => 0,
    log: () => undefined,
  }
  return createApiApp(deps, { token: 'secret' })
}

function request(path: string, init: RequestInit = {}): Request {
  return new Request(`http://clara.local${path}`, {
    ...init,
    headers: { authorization: 'Bearer secret', ...init.headers },
  })
}

function post(path: string, body: unknown): Request {
  return request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('multi-harness sessions and projects', () => {
  it('lists sessions from every linked harness and reports per-harness status', async () => {
    const fake = fixture({
      links: {
        p_demo: [
          ['harness-a', 'project-a'],
          ['harness-b', 'project-b'],
        ],
      },
      sessions: {
        'harness-a:project-a': [session('s1', 'project-a', 10), session('s2', 'project-a', 30)],
        'harness-b:project-b': [session('s2', 'project-b', 30), session('s3', 'project-b', 20)],
      },
    })
    const api = createTestApi(fake.harness)

    const response = await api.fetch(request('/v1/sessions?project=p_demo'))
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      data: ClaraSession[]
      harnesses: Array<{
        harnessID: string
        label: string
        kind: string
        online: boolean
        ok: boolean
      }>
      cursor: { next: string | null }
    }

    expect(body.data.map((item) => item.id)).toEqual(['s2', 's3', 's1'])
    expect(body.data.every((item) => item.harnessID !== undefined)).toBe(true)
    expect(body.harnesses.map((item) => item.harnessID).sort()).toEqual(['harness-a', 'harness-b'])
    expect(body.harnesses.every((item) => item.ok && item.online)).toBe(true)
    expect(fake.requests.map((item) => item.harnessID)).toEqual(['harness-a', 'harness-b'])
    expect(fake.requests.some((item) => item.search.get('project') === 'p_demo')).toBe(false)
    expect(decodeMergedSessionCursor(body.cursor.next ?? undefined)).toEqual({
      v: 2,
      projects: {
        'harness-a:project-a': 'harness-a:project-a-next',
        'harness-b:project-b': 'harness-b:project-b-next',
      },
    })
  })

  it('returns rows when only a non-active harness owns the project', async () => {
    const fake = fixture({
      links: { p_demo: [['harness-b', 'project-b']] },
      sessions: { 'harness-b:project-b': [session('s1', 'project-b', 10)] },
    })
    const api = createTestApi(fake.harness)

    const response = await api.fetch(request('/v1/sessions?project=p_demo'))
    expect(response.status).toBe(200)
    const body = (await response.json()) as { data: ClaraSession[] }
    expect(body.data.map((item) => item.id)).toEqual(['s1'])
    expect(body.data[0]?.harnessID).toBe('harness-b')
    expect(fake.requests.map((item) => item.harnessID)).toEqual(['harness-b'])
  })

  it('lists sessions from an explicitly requested harness without forwarding the hint', async () => {
    const fake = fixture()
    const api = createTestApi(fake.harness)

    const response = await api.fetch(request('/v1/sessions?harnessID=harness-b'))
    expect(response.status).toBe(200)
    expect(fake.requests).toHaveLength(1)
    expect(fake.requests[0]?.harnessID).toBe('harness-b')
    expect(fake.requests[0]?.search.has('harnessID')).toBe(false)
  })

  it('resolves a non-project session list by its workspace directory', async () => {
    const fake = fixture({
      workspaces: [{ harnessID: 'harness-b', directory: '/workspace/only-b' }],
    })
    const api = createTestApi(fake.harness)

    const response = await api.fetch(request('/v1/sessions?directory=%2Fworkspace%2Fonly-b'))
    expect(response.status).toBe(200)
    expect(fake.requests).toHaveLength(1)
    expect(fake.requests[0]?.harnessID).toBe('harness-b')
    expect(fake.requests[0]?.search.get('directory')).toBe('/workspace/only-b')
    expect(fake.requests[0]?.search.has('harnessID')).toBe(false)
  })

  it('reports a failed record when a single harness owns several records', async () => {
    const fake = fixture({
      links: {
        p_demo: [
          ['harness-a', 'project-a'],
          ['harness-a', 'project-b'],
        ],
      },
      sessions: { 'harness-a:project-a': [session('s1', 'project-a', 10)] },
      failing: [['harness-a', 'project-b']],
    })
    const api = createTestApi(fake.harness)

    const response = await api.fetch(request('/v1/sessions?project=p_demo'))
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      data: ClaraSession[]
      harnesses: Array<{
        harnessID: string
        online: boolean
        ok: boolean
        code?: string
        message?: string
      }>
    }
    expect(body.data.map((item) => item.id)).toEqual(['s1'])
    expect(body.harnesses).toEqual([
      {
        harnessID: 'harness-a',
        label: 'Harness harness-a',
        kind: 'opencode',
        online: true,
        ok: false,
        code: 'record_failed',
        message: 'record failed',
      },
    ])
  })

  it('creates a session on the requested harness and strips harnessID', async () => {
    const fake = fixture()
    const api = createTestApi(fake.harness)

    const response = await api.fetch(
      post('/v1/sessions', { harnessID: 'harness-b', title: 'New session' })
    )
    expect(response.status).toBe(200)
    const body = (await response.json()) as ClaraSession
    expect(body.id).toBe('created-harness-b')
    expect(body.harnessID).toBe('harness-b')
    expect(fake.requests).toHaveLength(1)
    expect(fake.requests[0]?.harnessID).toBe('harness-b')
    expect(fake.requests[0]?.body).toEqual({ title: 'New session' })
  })

  it('creates a session in the directory workspace when no harness is requested', async () => {
    const fake = fixture({
      workspaces: [{ harnessID: 'harness-b', directory: '/workspace/only-b' }],
    })
    const api = createTestApi(fake.harness)

    const response = await api.fetch(
      post('/v1/sessions', { location: { directory: '/workspace/only-b' } })
    )
    expect(response.status).toBe(200)
    expect(fake.requests[0]?.harnessID).toBe('harness-b')
  })

  it('reads a session from the harness that owns it, not the active one', async () => {
    const fake = fixture({
      links: { p_demo: [['harness-b', 'project-b']] },
      sessions: { 'harness-b:project-b': [session('s-b', 'project-b', 10)] },
    })
    const api = createTestApi(fake.harness)

    const response = await api.fetch(request('/v1/sessions/s-b'))
    expect(response.status).toBe(200)
    const body = (await response.json()) as ClaraSession
    expect(body.id).toBe('s-b')
    expect(body.harnessID).toBe('harness-b')
    expect(fake.requests[0]?.harnessID).toBe('harness-b')
  })

  it('writes session metadata against the resolved harness', async () => {
    const fake = fixture({ sessions: { 'harness-b:project-b': [session('s-b', 'project-b', 10)] } })
    const api = createTestApi(fake.harness)

    const response = await api.fetch(
      request('/v1/sessions/s-b', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Renamed', archived: true }),
      })
    )
    expect(response.status).toBe(204)
    expect(fake.requests[0]?.harnessID).toBe('harness-b')
    expect(fake.metadata.titles).toEqual([['harness-b', 's-b', 'Renamed']])
    expect(fake.metadata.archived).toEqual([['harness-b', 's-b', true]])
  })

  it('returns partial rows and an offline status when one harness cannot answer', async () => {
    const fake = fixture({
      offline: ['harness-b'],
      links: {
        p_demo: [
          ['harness-a', 'project-a'],
          ['harness-b', 'project-b'],
        ],
      },
      sessions: { 'harness-a:project-a': [session('s1', 'project-a', 10)] },
    })
    const api = createTestApi(fake.harness)

    const response = await api.fetch(request('/v1/sessions?project=p_demo'))
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      data: ClaraSession[]
      harnesses: Array<{
        harnessID: string
        online: boolean
        ok: boolean
        code?: string
      }>
    }
    expect(body.data.map((item) => item.id)).toEqual(['s1'])
    const offline = body.harnesses.find((item) => item.harnessID === 'harness-b')
    expect(offline).toMatchObject({ online: false, ok: false, code: 'harness_offline' })
    expect(body.harnesses.find((item) => item.harnessID === 'harness-a')).toMatchObject({
      online: true,
      ok: true,
    })
  })

  it('fails the list when no linked harness can answer', async () => {
    const fake = fixture({
      offline: ['harness-a', 'harness-b'],
      links: {
        p_demo: [
          ['harness-a', 'project-a'],
          ['harness-b', 'project-b'],
        ],
      },
    })
    const api = createTestApi(fake.harness)

    const response = await api.fetch(request('/v1/sessions?project=p_demo'))
    expect(response.status).toBe(503)
    const body = (await response.json()) as { error: { code: string } }
    expect(body.error.code).toBe('harness_offline')
  })

  it('merges active sessions across online harnesses', async () => {
    const fake = fixture()
    const api = createTestApi(fake.harness)

    const response = await api.fetch(request('/v1/sessions/active'))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      'harness-a-running': { type: 'running' },
      'harness-b-running': { type: 'running' },
    })
  })

  it('fans worktrees out to every linked harness and merges by directory', async () => {
    const fake = fixture({
      links: {
        p_demo: [
          ['harness-a', 'project-a'],
          ['harness-b', 'project-b'],
        ],
      },
    })
    const api = createTestApi(fake.harness)

    const response = await api.fetch(request('/v1/worktrees?project=p_demo'))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual([
      { directory: '/workspace/demo', strategy: 'harness-a:project-a' },
    ])
    expect(fake.requests.map((item) => item.harnessID)).toEqual(['harness-a', 'harness-b'])
  })

  it('refreshes worktrees on every linked harness', async () => {
    const fake = fixture({
      links: {
        p_demo: [
          ['harness-a', 'project-a'],
          ['harness-b', 'project-b'],
        ],
      },
    })
    const api = createTestApi(fake.harness)

    const response = await api.fetch(post('/v1/worktrees/refresh', { projectID: 'p_demo' }))
    expect(response.status).toBe(204)
    expect(fake.requests.map((item) => item.harnessID)).toEqual(['harness-a', 'harness-b'])
  })

  it('rejects an ambiguous directory instead of guessing a harness', async () => {
    const fake = fixture({
      active: 'harness-c',
      connections: ['harness-a', 'harness-b', 'harness-c'],
      workspaces: [
        { harnessID: 'harness-a', directory: '/workspace/shared' },
        { harnessID: 'harness-b', directory: '/workspace/shared' },
      ],
    })
    const api = createTestApi(fake.harness)

    const response = await api.fetch(
      post('/v1/sessions', { location: { directory: '/workspace/shared' } })
    )
    expect(response.status).toBe(409)
    const body = (await response.json()) as { error: { code: string } }
    expect(body.error.code).toBe('harness_ambiguous')
    expect(fake.requests).toHaveLength(0)
  })

  it('resolves permissions from an explicit harness', async () => {
    const fake = fixture()
    const api = createTestApi(fake.harness)

    const response = await api.fetch(request('/v1/permissions?harnessID=harness-b'))
    expect(response.status).toBe(200)
    expect(fake.requests[0]?.harnessID).toBe('harness-b')
    expect(fake.requests[0]?.path).toBe('/permissions')
  })

  it('routes a parentID list through the parent session harness', async () => {
    const fake = fixture({
      sessions: {
        'harness-b:project-b': [session('s-b', 'project-b', 10)],
      },
    })
    const api = createTestApi(fake.harness)

    const response = await api.fetch(request('/v1/sessions?parentID=s-b'))
    expect(response.status).toBe(200)
    expect(fake.requests[0]?.harnessID).toBe('harness-b')
    expect(fake.requests[0]?.search.get('parentID')).toBe('s-b')
  })

  it('filters a project list to an explicit harness', async () => {
    const fake = fixture({
      links: {
        p_demo: [
          ['harness-a', 'project-a'],
          ['harness-b', 'project-b'],
        ],
      },
      sessions: {
        'harness-a:project-a': [session('s-a', 'project-a', 10)],
        'harness-b:project-b': [session('s-b', 'project-b', 20)],
      },
    })
    const api = createTestApi(fake.harness)

    const response = await api.fetch(request('/v1/sessions?project=p_demo&harnessID=harness-b'))
    expect(response.status).toBe(200)
    expect(fake.requests.map((item) => item.harnessID)).toEqual(['harness-b'])
    const body = (await response.json()) as { data: ClaraSession[] }
    expect(body.data.map((item) => item.id)).toEqual(['s-b'])
  })

  it('merges active sessions only for the requested harness', async () => {
    const fake = fixture()
    const api = createTestApi(fake.harness)

    const response = await api.fetch(request('/v1/sessions/active?harnessID=harness-b'))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ 'harness-b-running': { type: 'running' } })
    expect(fake.requests.map((item) => item.harnessID)).toEqual(['harness-b'])
  })
})
