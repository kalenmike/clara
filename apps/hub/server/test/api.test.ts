import { describe, expect, it } from 'vitest'
import type { HarnessManager } from '../src/harness/manager.ts'
import { createApiApp } from '../src/api/app.ts'
import type { ApiDependencies } from '../src/api/context.ts'
import type { ProjectStore } from '../src/projects/store.ts'

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const connection = {
  id: 'h1',
  harnessId: 'harness-a',
  kind: 'opencode',
  label: 'Test OpenCode',
  transport: 'local' as const,
  online: true,
  capabilities: {},
  credentialConfigured: true,
  createdAt: 1,
  updatedAt: 1,
}

function fakeProjects(): ProjectStore {
  const record = {
    project: {
      id: 'p1',
      name: 'Demo',
      createdAt: 1,
      updatedAt: 2,
      lastActiveAt: 3,
    },
    workspaces: [],
  }
  return {
    list: () => [record],
    get: (projectID: string) => (projectID === 'p1' ? record : undefined),
    linksForProject: () => [],
    workspacesForDirectory: () => [],
  } as unknown as ProjectStore
}

function fakeHarness(): HarnessManager {
  const harness = {
    configured: true,
    generation: 3,
    active: connection,
    lastError: undefined,
    harnessId: 'harness-a',
    projects: fakeProjects(),
    list: () => [connection],
    connection: () => connection,
    overlaySessionList: (value: { data: unknown[]; cursor: unknown }) => value,
    request: async (action: { path: string }): Promise<Response> => {
      if (action.path === '/harness/info' || action.path === '/api/info') {
        return json({ version: '9.9.9', pid: 42, urls: [], paths: { tmp: '/tmp' } })
      }
      if (action.path === '/projects' || action.path === '/api/project') {
        return json([
          {
            id: 'p1',
            canonical: '/workspace/demo',
            name: 'Demo',
            time: { created: 1, updated: 2, active: 3 },
            sandboxes: [],
          },
        ])
      }
      if (action.path === '/sessions' || action.path === '/api/session')
        return json({ data: [], cursor: {} })
      if (action.path === '/sessions/active' || action.path === '/api/session/active')
        return json({})
      return json({ error: { code: 'not_found', message: 'not found' } }, 404)
    },
  } as unknown as HarnessManager & {
    request: (action: { path: string }) => Promise<Response>
  }
  ;(
    harness as unknown as {
      requestFor: (harnessID: string, action: { path: string }) => Promise<Response>
    }
  ).requestFor = (_harnessID, action) => harness.request(action)
  return harness
}

function createTestApi(
  harness: HarnessManager = fakeHarness(),
  extra: Partial<ApiDependencies> = {}
) {
  const deps: ApiDependencies = {
    harness,
    info: { version: '0.1.0', protocol: 1 },
    startedAt: 1000,
    canAccess: () => true,
    sessionCount: () => 2,
    log: () => undefined,
    ...extra,
  }
  return createApiApp(deps, { token: 'secret' })
}

const adapterManifest = {
  schemaVersion: 1 as const,
  harness: 'opencode',
  version: '0.1.0',
  install: 'https://clara.example/adapters/opencode/install.sh',
  installSha256: 'a'.repeat(64),
  artifacts: {},
}

function request(path: string, init: RequestInit = {}): Request {
  return new Request(`http://clara.local${path}`, init)
}

describe('hub API', () => {
  it('serves the OpenAPI document with Clara components', async () => {
    const api = createTestApi()
    const response = await api.fetch(request('/openapi.json'))
    expect(response.status).toBe(200)
    const document = (await response.json()) as {
      paths: Record<string, unknown>
      components: { schemas: Record<string, unknown> }
    }
    expect(document.paths['/v1/projects']).toBeDefined()
    expect(document.paths['/v1/sessions/{sessionID}/messages']).toBeDefined()
    expect(document.components.schemas.ClaraSession).toBeDefined()
    expect(document.components.schemas.ClaraProject).toBeDefined()
  })

  it('rejects local HTTP requests without a bearer token', async () => {
    const api = createTestApi()
    const response = await api.fetch(request('/v1/projects'))
    expect(response.status).toBe(401)
  })

  it('accepts a bearer token on the loopback API', async () => {
    const api = createTestApi()
    const response = await api.fetch(
      request('/v1/projects', { headers: { authorization: 'Bearer secret' } })
    )
    expect(response.status).toBe(200)
    const projects = (await response.json()) as Array<{ id: string }>
    expect(projects[0]?.id).toBe('p1')
  })

  it('rejects an invalid upstream payload with upstream_invalid', async () => {
    const harness = fakeHarness()
    ;(harness as unknown as { request: () => Promise<Response> }).request = async () =>
      json({ id: 'incomplete-location' })
    const api = createTestApi(harness)
    const response = await api.fetch(
      request('/v1/locations?directory=/workspace/demo&harnessID=harness-a', {
        headers: { authorization: 'Bearer secret' },
      })
    )
    expect(response.status).toBe(502)
    const body = (await response.json()) as { error: { code: string } }
    expect(body.error.code).toBe('upstream_invalid')
  })

  it('accepts the trusted agent header from the WebSocket bridge', async () => {
    const api = createTestApi()
    const response = await api.fetch(
      request('/v1/sessions?harnessID=harness-a', { headers: { 'x-clara-agent': '1' } })
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ data: [], cursor: {} })
  })

  it('rejects writes from a read-only client', async () => {
    const api = createTestApi()
    const response = await api.fetch(
      request('/v1/sessions', {
        method: 'POST',
        headers: {
          authorization: 'Bearer secret',
          'x-clara-readonly': '1',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ title: 'New' }),
      })
    )
    expect(response.status).toBe(403)
  })

  it('issues an adapter pairing and serves its manifest', async () => {
    const inputs: Array<Record<string, unknown>> = []
    const api = createTestApi(fakeHarness(), {
      createAdapterPairing: async (input) => {
        inputs.push(input)
        return {
          pairing: {
            id: 'pair-1',
            kind: input.kind,
            label: 'OpenCode',
            code: 'clara-harness1_code',
            transport: 'relay',
            wsUrl: 'wss://relay.example/room/room',
            room: 'room',
            fingerprint: 'fp',
            expiresAt: new Date(1_000).toISOString(),
            createdAt: new Date(0).toISOString(),
          },
          manifest: adapterManifest,
          command: 'curl -fsSL https://clara.example/adapters/opencode/install.sh | sh',
          deepLink: 'clara://adapter?code=clara-harness1_code&kind=opencode',
        }
      },
      adapterManifest: async () => adapterManifest,
    })

    const pairing = await api.fetch(
      request('/v1/harness/pairings', {
        method: 'POST',
        headers: { authorization: 'Bearer secret', 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: 'opencode',
          method: 'ssh',
          transport: 'local',
          wsUrl: 'ws://192.168.1.20:8788/ws',
          opencodeUrl: 'http://127.0.0.1:4096',
        }),
      })
    )
    expect(pairing.status).toBe(200)
    expect(await pairing.json()).toMatchObject({
      pairing: { kind: 'opencode' },
      deepLink: 'clara://adapter?code=clara-harness1_code&kind=opencode',
    })
    expect(inputs).toEqual([
      {
        kind: 'opencode',
        method: 'ssh',
        transport: 'local',
        wsUrl: 'ws://192.168.1.20:8788/ws',
        opencodeUrl: 'http://127.0.0.1:4096',
      },
    ])

    const manifest = await api.fetch(
      request('/v1/harness/adapters/opencode', {
        headers: { authorization: 'Bearer secret' },
      })
    )
    expect(manifest.status).toBe(200)
    expect(await manifest.json()).toMatchObject({ manifest: { version: '0.1.0' } })
  })

  it('returns hub and harness status without adapter endpoints', async () => {
    const api = createTestApi(undefined, {
      info: {
        version: '0.1.0',
        protocol: 1,
        endpoints: { web: 'https://clara.example.com' },
      },
    })
    const response = await api.fetch(
      request('/v1/info', { headers: { authorization: 'Bearer secret' } })
    )
    expect(response.status).toBe(200)
    const info = (await response.json()) as {
      harness: { configured: boolean; generation: number }
      api: { version: string }
      agent: { endpoints?: unknown }
    }
    expect(info.harness.configured).toBe(true)
    expect(info.harness.generation).toBe(3)
    expect(info.api.version).toBe('v1')
    expect(info.agent.endpoints).toBeUndefined()
  })
})
