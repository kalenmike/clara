import { describe, expect, it } from 'vitest'
import { createApiApp } from '../src/api/app.ts'
import type { ApiDependencies } from '../src/api/context.ts'
import type { HarnessManager } from '../src/harness/manager.ts'
import type { ProjectStore } from '../src/projects/store.ts'

const connection = (harnessID: string, active: boolean) => ({
  id: `connection-${harnessID}`,
  harnessId: harnessID,
  kind: 'opencode',
  label: harnessID,
  transport: 'local' as const,
  online: true,
  capabilities: {},
  isActive: active,
  credentialConfigured: true,
  createdAt: 1,
  updatedAt: 1,
})

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function createTestApi() {
  const calls: Array<{ harnessID: string; path: string; search?: string }> = []
  const connections = [connection('harness-a', true), connection('harness-b', false)]

  const harness = {
    configured: true,
    generation: 1,
    active: connections[0],
    lastError: undefined,
    harnessId: 'harness-a',
    list: () => connections,
    connection: (harnessID: string) => connections.find((item) => item.harnessId === harnessID),
    projects: {
      workspacesForDirectory: (directory: string) =>
        directory === '/workspace/shared'
          ? [{ harnessID: 'harness-b', projectID: 'p_shared', directory }]
          : [],
    } as unknown as ProjectStore,
    requestFor: async (
      harnessID: string,
      input: { path: string; search?: string }
    ): Promise<Response> => {
      calls.push({ harnessID, path: input.path, search: input.search })
      if (input.path === '/commands') {
        return json({ location: { directory: '/workspace/demo' }, data: [{ name: 'test' }] })
      }
      if (input.path === '/skills') {
        const directory =
          new URLSearchParams(input.search ?? '').get('directory') ?? '/workspace/shared'
        return json({
          location: { directory },
          data: [{ id: 'skill', name: 'test', path: '/skill', content: 'body' }],
        })
      }
      if (input.path === '/events') {
        return new Response('data: {"type":"session.idle"}\n\n', {
          headers: { 'content-type': 'text/event-stream' },
        })
      }
      if (input.path === '/git/log') {
        return json([
          {
            hash: 'abc123',
            authorName: 'Ada',
            authorEmail: 'ada@example.com',
            authoredAt: '2026-01-01T00:00:00.000Z',
            subject: 'Ship it',
            body: '',
          },
        ])
      }
      return json({ error: { code: 'not_found', message: 'not found' } }, 404)
    },
  } as unknown as HarnessManager

  const deps: ApiDependencies = {
    harness,
    info: { version: '0.1.0', protocol: 1 },
    startedAt: 1000,
    canAccess: () => true,
    sessionCount: () => 0,
    log: () => undefined,
  }
  return { api: createApiApp(deps, { token: 'secret' }), calls }
}

function request(path: string): Request {
  return new Request(`http://clara.local${path}`, {
    headers: { authorization: 'Bearer secret' },
  })
}

describe('harness-scoped routes', () => {
  it('routes catalog requests to an explicit harness and rejects a missing one', async () => {
    const { api, calls } = createTestApi()

    const explicit = await api.fetch(request('/v1/commands?harnessID=harness-b'))
    expect(explicit.status).toBe(200)
    expect(calls.at(-1)).toMatchObject({ harnessID: 'harness-b', path: '/commands' })

    const missing = await api.fetch(request('/v1/commands'))
    expect(missing.status).toBe(409)
    expect((await missing.json()) as { error: { code: string } }).toMatchObject({
      error: { code: 'harness_required' },
    })
  })

  it('resolves skills by directory when exactly one harness matches', async () => {
    const { api, calls } = createTestApi()

    const response = await api.fetch(request('/v1/skills?directory=/workspace/shared'))
    expect(response.status).toBe(200)
    expect(calls.at(-1)).toMatchObject({
      harnessID: 'harness-b',
      path: '/skills',
      search: '?directory=%2Fworkspace%2Fshared',
    })
  })

  it('forwards the event stream to the requested harness', async () => {
    const { api, calls } = createTestApi()

    const response = await api.fetch(request('/v1/events?harnessID=harness-b'))
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/event-stream')
    expect(await response.text()).toContain('session.idle')
    expect(calls.at(-1)).toMatchObject({ harnessID: 'harness-b', path: '/events' })
  })

  it('routes git history by explicit harness before directory', async () => {
    const { api, calls } = createTestApi()

    const response = await api.fetch(
      request('/v1/git/log?directory=/workspace/shared&since=0&harnessID=harness-a')
    )
    expect(response.status).toBe(200)
    expect(((await response.json()) as Array<{ hash: string }>)[0]?.hash).toBe('abc123')
    expect(calls.at(-1)).toMatchObject({ harnessID: 'harness-a', path: '/git/log' })
    expect(calls.at(-1)?.search).not.toContain('harnessID')
  })
})
