import { describe, expect, it } from 'vitest'
import type { ClaraHarnessProject, ClaraSession } from '@clara/api-contract'
import { createApiApp } from '../src/api/app.ts'
import type { ApiDependencies } from '../src/api/context.ts'
import {
  decodeMergedSessionCursor,
  mergeSessionPages,
  type SessionPage,
} from '../src/api/session-pages.ts'
import type { HarnessManager } from '../src/harness/manager.ts'

type HarnessRequest = { path: string; search: URLSearchParams }

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

type FakeHarness = {
  harness: HarnessManager
  links: Map<string, string[]>
  requests: HarnessRequest[]
  sessions: Map<string, ClaraSession[]>
  projects: ClaraHarnessProject[]
  cursors: Map<string, string>
}

function fakeHarness(options: { projects?: ClaraHarnessProject[] } = {}): FakeHarness {
  const links = new Map<string, string[]>()
  const requests: HarnessRequest[] = []
  const sessions = new Map<string, ClaraSession[]>()
  const cursors = new Map<string, string>()
  const projects = options.projects ?? []
  const workspace = {
    id: 'w_demo',
    projectID: 'p_demo',
    harnessID: 'harness-a',
    directory: '/workspace/demo',
    canonical: '/workspace/demo',
    createdAt: 1,
    updatedAt: 2,
  }
  const projectState = {
    id: 'p_demo',
    defaultWorkspaceID: 'w_demo',
    createdAt: 1,
    updatedAt: 2,
    lastActiveAt: 3,
  }
  const projectStore = {
    get: (projectID: string) =>
      projectID === 'p_demo' ? { project: projectState, workspaces: [workspace] } : undefined,
    linksForProject: (projectID: string) =>
      (links.get(projectID) ?? []).map((harnessProjectID) => ({
        harness_id: 'harness-a',
        harness_project_id: harnessProjectID,
        project_id: projectID,
        workspace_id: 'w_demo',
        last_seen_at: 3,
      })),
    linkHarnessProject: (input: { harnessProjectID: string; projectID: string }) => {
      const current = links.get(input.projectID) ?? []
      if (!current.includes(input.harnessProjectID)) current.push(input.harnessProjectID)
      links.set(input.projectID, current)
    },
    reconcileWorkspaceLinks: (input: {
      projectID: string
      harnessProjectIDs: string[]
    }): { linked: number; conflicts: string[] } => {
      const conflicts = input.harnessProjectIDs.filter((harnessProjectID) => {
        for (const [projectID, ids] of links) {
          if (projectID !== input.projectID && ids.includes(harnessProjectID)) return true
        }
        return false
      })
      if (conflicts.length > 0) return { linked: 0, conflicts }
      const current = links.get(input.projectID) ?? []
      links.set(input.projectID, [...new Set([...current, ...input.harnessProjectIDs])])
      return { linked: input.harnessProjectIDs.length, conflicts: [] }
    },
    updateWorkspace: () => workspace,
    findWorkspaceByCanonical: (harnessID: string, canonical: string) =>
      harnessID === 'harness-a' && canonical === '/workspace/demo' ? workspace : undefined,
    linkForHarnessProject: (harnessID: string, harnessProjectID: string) =>
      harnessID === 'harness-a' && (links.get('p_demo') ?? []).includes(harnessProjectID)
        ? { harness_id: 'harness-a', harness_project_id: harnessProjectID, project_id: 'p_demo' }
        : undefined,
    workspace: () => workspace,
  }

  const harness = {
    configured: true,
    generation: 1,
    active: {
      id: 'h1',
      harnessId: 'harness-a',
      kind: 'opencode',
      label: 'Test OpenCode',
      transport: 'local',
      online: true,
      capabilities: {},
      isActive: true,
      credentialConfigured: true,
      createdAt: 1,
      updatedAt: 1,
    },
    lastError: undefined,
    harnessId: 'harness-a',
    projects: projectStore,
    harnessProjectIds: (projectId: string) => links.get(projectId) ?? [],
    overlaySessionList: <T>(value: T) => value,
    overlaySession: (harnessID: string, item: ClaraSession) => ({ ...item, harnessID }),
    connection: () => harness.active,
    request: async (action: { path: string; search?: string }) => {
      const search = new URLSearchParams(action.search ?? '')
      requests.push({ path: action.path, search })
      if (action.path === '/locations') {
        const directory = search.get('directory') ?? ''
        return json({
          directory,
          project: { id: 'project-a', directory, canonical: directory },
        })
      }
      if (action.path === '/projects') return json(projects)
      if (action.path === '/sessions') {
        const projectID = search.get('project') ?? ''
        const cursor = search.get('cursor')
        if (cursor) cursors.set(projectID, cursor)
        return json({
          data: sessions.get(projectID) ?? [],
          cursor: { previous: null, next: `${projectID}-next` },
        })
      }
      if (action.path === '/worktrees') {
        const projectID = search.get('projectID') ?? ''
        return json([{ directory: '/workspace/demo', strategy: projectID }])
      }
      return json({ error: { code: 'not_found', message: 'not found' } }, 404)
    },
  } as unknown as HarnessManager
  ;(
    harness as unknown as {
      requestFor: (harnessID: string, input: { path: string; search?: string }) => Promise<Response>
    }
  ).requestFor = (_harnessID, input) =>
    (
      harness as unknown as {
        request: (input: { path: string; search?: string }) => Promise<Response>
      }
    ).request(input)

  return { harness, links, requests, sessions, projects, cursors }
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

function request(path: string): Request {
  return new Request(`http://clara.local${path}`, {
    headers: { authorization: 'Bearer secret' },
  })
}

const PROJECT: ClaraHarnessProject = {
  id: 'project-a',
  canonical: '/workspace/demo',
  time: { created: 1, updated: 2, active: 3 },
  sandboxes: [],
}

describe('project session mapping', () => {
  it('merges every linked harness record without forwarding the Clara id', async () => {
    const fake = fakeHarness()
    fake.links.set('p_demo', ['project-a', 'project-b'])
    fake.sessions.set('project-a', [session('s1', 'project-a', 10), session('s2', 'project-a', 30)])
    fake.sessions.set('project-b', [session('s2', 'project-b', 30), session('s3', 'project-b', 20)])
    const api = createTestApi(fake.harness)

    const response = await api.fetch(request('/v1/sessions?project=p_demo&archived=false&limit=50'))
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      data: ClaraSession[]
      cursor: { next: string | null }
    }

    expect(body.data.map((item) => item.id)).toEqual(['s2', 's3', 's1'])
    expect(fake.requests.map((item) => item.search.get('project'))).toEqual([
      'project-a',
      'project-b',
    ])
    expect(fake.requests.some((item) => item.search.get('project') === 'p_demo')).toBe(false)

    expect(decodeMergedSessionCursor(body.cursor.next ?? undefined)).toEqual({
      v: 2,
      projects: {
        'harness-a:project-a': 'project-a-next',
        'harness-a:project-b': 'project-b-next',
      },
    })
  })

  it('keeps a per-record cursor when paging a merged project', async () => {
    const fake = fakeHarness()
    fake.links.set('p_demo', ['project-a', 'project-b'])
    const api = createTestApi(fake.harness)
    const first = await api.fetch(request('/v1/sessions?project=p_demo'))
    const { cursor } = (await first.json()) as { cursor: { next: string } }

    await api.fetch(
      request(`/v1/sessions?project=p_demo&cursor=${encodeURIComponent(cursor.next)}`)
    )

    expect(fake.requests.at(-2)?.search.get('project')).toBe('project-a')
    expect(fake.requests.at(-2)?.search.get('cursor')).toBe('project-a-next')
    expect(fake.requests.at(-1)?.search.get('project')).toBe('project-b')
    expect(fake.requests.at(-1)?.search.get('cursor')).toBe('project-b-next')
  })

  it('passes a legacy cursor through for a single linked record', async () => {
    const fake = fakeHarness()
    fake.links.set('p_demo', ['project-a'])
    const api = createTestApi(fake.harness)

    await api.fetch(request('/v1/sessions?project=p_demo&cursor=opaque-open-curve'))

    expect(fake.requests).toHaveLength(1)
    expect(fake.requests[0]?.search.get('project')).toBe('project-a')
    expect(fake.requests[0]?.search.get('cursor')).toBe('opaque-open-curve')
  })

  it('syncs a project workspace from the harness location before failing', async () => {
    const fake = fakeHarness({ projects: [PROJECT] })
    fake.sessions.set('project-a', [session('s1', 'project-a', 10)])
    const api = createTestApi(fake.harness)

    const response = await api.fetch(request('/v1/sessions?project=p_demo'))

    expect(response.status).toBe(200)
    const body = (await response.json()) as { data: ClaraSession[] }
    expect(body.data.map((item) => item.id)).toEqual(['s1'])
    expect(fake.requests[0]?.path).toBe('/locations')
    expect(fake.requests[0]?.search.get('directory')).toBe('/workspace/demo')
    expect(fake.requests.some((item) => item.search.get('project') === 'p_demo')).toBe(false)
  })

  it('returns project_unmapped instead of an empty list when no record exists', async () => {
    const fake = fakeHarness()
    const api = createTestApi(fake.harness)

    const response = await api.fetch(request('/v1/sessions?project=p_missing'))

    expect(response.status).toBe(409)
    const body = (await response.json()) as { error: { code: string } }
    expect(body.error.code).toBe('project_unmapped')
    expect(fake.requests.some((item) => item.search.get('project') === 'p_missing')).toBe(false)
  })

  it('merges worktrees across every linked record', async () => {
    const fake = fakeHarness()
    fake.links.set('p_demo', ['project-a', 'project-b'])
    const api = createTestApi(fake.harness)

    const response = await api.fetch(request('/v1/worktrees?project=p_demo'))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual([{ directory: '/workspace/demo', strategy: 'project-a' }])
    expect(fake.requests.map((item) => item.search.get('projectID'))).toEqual([
      'project-a',
      'project-b',
    ])
  })
})

describe('mergeSessionPages', () => {
  it('orders ascending and keeps both records cursors', () => {
    const pages: SessionPage[] = [
      {
        harnessID: 'harness-a',
        projectID: 'a',
        data: [session('s2', 'a', 20)],
        cursor: { previous: null, next: 'a-next' },
      },
      {
        harnessID: 'harness-a',
        projectID: 'b',
        data: [session('s1', 'b', 10)],
        cursor: { previous: null, next: null },
      },
    ]

    const merged = mergeSessionPages(pages, 'asc')

    expect(merged.data.map((item) => item.id)).toEqual(['s1', 's2'])
    expect(decodeMergedSessionCursor(merged.cursor.next ?? undefined)).toEqual({
      v: 2,
      projects: { 'harness-a:a': 'a-next', 'harness-a:b': null },
    })
  })
})
