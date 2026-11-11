import { describe, expect, it } from 'vitest'
import type { HarnessManager } from '../src/harness/manager.ts'
import { createApiApp } from '../src/api/app.ts'
import type { ApiDependencies } from '../src/api/context.ts'

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function fakeHarness(): HarnessManager {
  return {
    configured: true,
    generation: 3,
    active: {
      kind: 'opencode',
      label: 'Test OpenCode',
      id: 'h1',
      baseUrl: 'http://127.0.0.1:4096',
      authType: 'none',
      options: {},
      isActive: true,
      createdAt: 1,
      updatedAt: 1,
      secretConfigured: false,
    },
    lastError: undefined,
    request: async (action: { path: string }) => {
      if (action.path === '/api/info') {
        return json({ version: '9.9.9', pid: 42, urls: [], paths: { tmp: '/tmp' } })
      }
      if (action.path === '/api/project') {
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
      if (action.path === '/api/session') return json({ data: [], cursor: {} })
      if (action.path === '/api/session/active') return json({})
      return json({ error: { code: 'not_found', message: 'not found' } }, 404)
    },
  } as unknown as HarnessManager
}

function createTestApi(harness: HarnessManager = fakeHarness()) {
  const deps: ApiDependencies = {
    harness,
    info: { version: '0.1.0', protocol: 1 },
    startedAt: 1000,
    canAccess: () => true,
    sessionCount: () => 2,
    log: () => undefined,
  }
  return createApiApp(deps, { token: 'secret' })
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
    harness.request = async () => json([{ id: 'incomplete-project' }])
    const api = createTestApi(harness)
    const response = await api.fetch(
      request('/v1/projects', { headers: { authorization: 'Bearer secret' } })
    )
    expect(response.status).toBe(502)
    const body = (await response.json()) as { error: { code: string } }
    expect(body.error.code).toBe('upstream_invalid')
  })

  it('accepts the trusted agent header from the WebSocket bridge', async () => {
    const api = createTestApi()
    const response = await api.fetch(request('/v1/sessions', { headers: { 'x-clara-agent': '1' } }))
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

  it('returns hub and harness status', async () => {
    const api = createTestApi()
    const response = await api.fetch(
      request('/v1/info', { headers: { authorization: 'Bearer secret' } })
    )
    expect(response.status).toBe(200)
    const info = (await response.json()) as {
      harness: { configured: boolean; generation: number }
      api: { version: string }
    }
    expect(info.harness.configured).toBe(true)
    expect(info.harness.generation).toBe(3)
    expect(info.api.version).toBe('v1')
  })
})
