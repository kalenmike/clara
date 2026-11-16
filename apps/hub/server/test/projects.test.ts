import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ClaraProject } from '@clara/api-contract'
import { createApiApp } from '../src/api/app.ts'
import type { ApiDependencies } from '../src/api/context.ts'
import type { HarnessManager } from '../src/harness/manager.ts'
import { ProjectStore } from '../src/projects/store.ts'
import { closeDatabase, openDatabase, type ClaraDatabase } from '../src/store/database.ts'

let dir: string
let db: ClaraDatabase
let projects: ProjectStore
let calls: Array<{ harnessID: string; path: string; search?: string }>

const connection = {
  id: 'h1',
  harnessId: 'harness-a',
  kind: 'opencode',
  label: 'Test harness',
  transport: 'local' as const,
  online: true,
  host: { hostname: 'build-box', platform: 'linux', arch: 'x64', installMethod: 'ssh' as const },
  capabilities: { projects: { list: true, archive: true, unarchive: true, delete: true } },
  isActive: true,
  credentialConfigured: true,
  createdAt: 1,
  updatedAt: 1,
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function fakeHarness(): HarnessManager {
  return {
    configured: true,
    generation: 1,
    active: connection,
    lastError: undefined,
    harnessId: 'harness-a',
    projects,
    list: () => [connection],
    connection: (harnessID: string) => (harnessID === 'harness-a' ? connection : undefined),
    harnessProjectIds: (projectID: string) => projects.harnessProjectIds('harness-a', projectID),
    overlaySessionList: (value: { data: unknown[]; cursor: unknown }) => value,
    requestFor: async (
      harnessID: string,
      input: { path: string; search?: string; method?: string }
    ) => {
      calls.push({ harnessID, path: input.path, search: input.search })
      if (input.path === '/locations') {
        const directory = new URLSearchParams(input.search ?? '').get('directory') ?? ''
        return json({
          directory,
          project: { id: 'hp1', directory, canonical: directory },
        })
      }
      if (input.path === '/projects') {
        return json([
          {
            id: 'hp1',
            canonical: '/workspace/demo',
            name: 'Demo',
            time: { created: 1, updated: 2, active: 3 },
            sandboxes: [],
          },
        ])
      }
      if (/\/projects\/[^/]+\/(archive|unarchive)$/.test(input.path)) {
        return json({ affected: 2 })
      }
      if (input.method === 'DELETE') return json({ affected: 5 })
      return json({ error: { code: 'not_found', message: 'not found' } }, 404)
    },
  } as unknown as HarnessManager
}

function createTestApi() {
  const deps: ApiDependencies = {
    harness: fakeHarness(),
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

async function createProject(
  api: ReturnType<typeof createTestApi>,
  name = 'Demo'
): Promise<ClaraProject> {
  const response = await api.fetch(
    request('/v1/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name }),
    })
  )
  expect(response.status).toBe(200)
  return (await response.json()) as ClaraProject
}

async function addWorkspace(
  api: ReturnType<typeof createTestApi>,
  project: ClaraProject
): Promise<ClaraProject> {
  const response = await api.fetch(
    request(`/v1/projects/${project.id}/workspaces`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ harnessID: 'harness-a', directory: '/workspace/demo' }),
    })
  )
  const text = await response.text()
  expect(response.status, text).toBe(200)
  return JSON.parse(text) as ClaraProject
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'clara-projects-'))
  db = openDatabase(join(dir, 'clara.db'))
  projects = new ProjectStore(db)
  calls = []
  db.prepare(
    `INSERT INTO harness_identities (harness_id, kind, first_seen_at, last_seen_at)
     VALUES ('harness-a', 'opencode', 1, 1)`
  ).run()
})

afterEach(() => {
  closeDatabase(db)
  rmSync(dir, { recursive: true, force: true })
})

describe('project store', () => {
  it('creates a container with no directory and tracks a default workspace', () => {
    const project = projects.create({ name: 'Demo' })
    expect(projects.get(project.id)?.workspaces).toEqual([])
    const workspace = projects.addWorkspace(project.id, {
      harnessID: 'harness-a',
      directory: '/workspace/demo',
    })
    expect(projects.get(project.id)?.project.defaultWorkspaceID).toBe(workspace.id)
    expect(projects.findWorkspaceByCanonical('harness-a', '/workspace/demo')?.id).toBe(workspace.id)
    projects.linkHarnessProject({
      harnessID: 'harness-a',
      harnessProjectID: 'hp1',
      projectID: project.id,
      workspaceID: workspace.id,
    })
    expect(projects.projectForHarnessProject('harness-a', 'hp1')?.id).toBe(project.id)
    expect(projects.workspaceForHarnessProject('harness-a', 'hp1')?.id).toBe(workspace.id)
  })

  it('detaches session metadata when a project is removed', () => {
    const project = projects.create({ name: 'Demo' })
    db.prepare(
      `INSERT INTO clara_sessions
         (harness_id, session_id, project_id, first_seen_at, last_seen_at)
       VALUES ('harness-a', 's1', ?, 1, 1)`
    ).run(project.id)
    expect(projects.delete(project.id)).toBe(true)
    const row = db
      .prepare("SELECT project_id FROM clara_sessions WHERE session_id = 's1'")
      .get() as { project_id: string }
    expect(row.project_id).toBe('unknown')
  })

  it('never reassigns a harness record to another Clara project', () => {
    const first = projects.create({ name: 'First' })
    const second = projects.create({ name: 'Second' })
    const firstWorkspace = projects.addWorkspace(first.id, {
      harnessID: 'harness-a',
      directory: '/workspace/first',
    })
    const secondWorkspace = projects.addWorkspace(second.id, {
      harnessID: 'harness-a',
      directory: '/workspace/second',
    })

    expect(
      projects.claimHarnessProject({
        harnessID: 'harness-a',
        harnessProjectID: 'hp1',
        projectID: first.id,
        workspaceID: firstWorkspace.id,
      })
    ).toBe(true)
    expect(
      projects.claimHarnessProject({
        harnessID: 'harness-a',
        harnessProjectID: 'hp1',
        projectID: second.id,
        workspaceID: secondWorkspace.id,
      })
    ).toBe(false)

    expect(projects.projectForHarnessProject('harness-a', 'hp1')?.id).toBe(first.id)
    expect(projects.workspaceForHarnessProject('harness-a', 'hp1')?.id).toBe(firstWorkspace.id)
  })
})

describe('project routes', () => {
  it('lists paired harnesses with the host they report', async () => {
    const api = createTestApi()
    const response = await api.fetch(request('/v1/harnesses'))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual([
      expect.objectContaining({
        harnessID: 'harness-a',
        label: 'Test harness',
        host: {
          hostname: 'build-box',
          platform: 'linux',
          arch: 'x64',
          installMethod: 'ssh',
        },
      }),
    ])
  })

  it('lists Clara projects without asking the harness', async () => {
    const api = createTestApi()
    const project = await createProject(api)
    calls = []
    const response = await api.fetch(request('/v1/projects'))
    expect(response.status).toBe(200)
    const body = (await response.json()) as ClaraProject[]
    expect(body.map((item) => item.id)).toEqual([project.id])
    expect(calls).toEqual([])
  })

  it('adds a workspace, links every matching harness record, and archives both sides', async () => {
    const api = createTestApi()
    const project = await addWorkspace(api, await createProject(api))
    const locationCall = calls.find((call) => call.path === '/locations')
    const locationSearch = new URLSearchParams(locationCall?.search ?? '')
    expect(locationSearch.get('directory')).toBe('/workspace/demo')
    expect(locationSearch.get('location[directory]')).toBeNull()
    expect(project.workspaces).toHaveLength(1)
    expect(project.workspaces[0]).toMatchObject({
      harnessLabel: 'Test harness',
      harnessHost: {
        hostname: 'build-box',
        platform: 'linux',
        arch: 'x64',
        installMethod: 'ssh',
      },
      linked: true,
      projectIDs: ['hp1'],
      directory: '/workspace/demo',
    })
    expect(project.defaultWorkspaceID).toBe(project.workspaces[0]?.id)

    const archived = await api.fetch(
      request(`/v1/projects/${project.id}/archive`, { method: 'POST' })
    )
    expect(archived.status).toBe(200)
    const body = (await archived.json()) as {
      project: ClaraProject
      harnesses: Array<{ ok: boolean; affected?: number }>
    }
    expect(body.project.time.archived).toBeDefined()
    expect(body.harnesses).toEqual([expect.objectContaining({ ok: true, affected: 2 })])
  })

  it('removes a project from Clara without signalling the harness', async () => {
    const api = createTestApi()
    const project = await addWorkspace(api, await createProject(api))
    calls = []
    const response = await api.fetch(
      request(`/v1/projects/${project.id}?mode=disconnect`, { method: 'DELETE' })
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ removed: true, harnesses: [] })
    expect(calls).toEqual([])
  })

  it('propagates deletion to every linked harness record', async () => {
    const api = createTestApi()
    const project = await addWorkspace(api, await createProject(api))
    calls = []
    const response = await api.fetch(request(`/v1/projects/${project.id}`, { method: 'DELETE' }))
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      harnesses: Array<{ ok: boolean; affected?: number }>
    }
    expect(body.harnesses).toEqual([expect.objectContaining({ ok: true, affected: 5 })])
    expect(calls).toEqual([{ harnessID: 'harness-a', path: '/projects/hp1' }])
    const missing = await api.fetch(request(`/v1/projects/${project.id}`))
    expect(missing.status).toBe(404)
  })

  it('does not move a linked harness record to another Clara project', async () => {
    const api = createTestApi()
    const first = await addWorkspace(api, await createProject(api, 'First'))
    const second = await createProject(api, 'Second')

    const response = await api.fetch(
      request(`/v1/projects/${second.id}/workspaces`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ harnessID: 'harness-a', directory: '/workspace/demo/sub' }),
      })
    )

    expect(response.status).toBe(409)
    const body = (await response.json()) as { error: { code: string } }
    expect(body.error.code).toBe('workspace_conflict')
    expect(projects.get(second.id)?.workspaces).toEqual([])
    expect(projects.projectForHarnessProject('harness-a', 'hp1')?.id).toBe(first.id)
  })

  it('drops stale linked records when a workspace is resolved again', async () => {
    const api = createTestApi()
    const project = await addWorkspace(api, await createProject(api))
    const workspace = project.workspaces[0]
    expect(workspace).toBeDefined()
    projects.linkHarnessProject({
      harnessID: 'harness-a',
      harnessProjectID: 'hp-stale',
      projectID: project.id,
      workspaceID: workspace!.id,
    })

    const response = await api.fetch(request(`/v1/projects/${project.id}/sync`, { method: 'POST' }))

    expect(response.status).toBe(200)
    const synced = (await response.json()) as ClaraProject
    expect(projects.linkForHarnessProject('harness-a', 'hp-stale')).toBeUndefined()
    expect(synced.workspaces[0]?.projectIDs).toEqual(['hp1'])
  })
})
