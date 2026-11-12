import { describe, expect, it } from 'vitest'
import type {
  ClaraJsonValue,
  ClaraSession,
  ClaraSessionMessage,
  ClaraSessionMessageAssistant,
} from '@clara/api-contract'
import { createApiApp } from '../src/api/app.ts'
import type { ApiDependencies } from '../src/api/context.ts'
import type { HarnessManager } from '../src/harness/manager.ts'

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function session(id: string, updated = 2): ClaraSession {
  return {
    id,
    projectID: 'hp1',
    cost: 0.5,
    tokens: { input: 100, output: 20, reasoning: 0, cache: { read: 10, write: 2 } },
    time: { created: 1, updated },
    location: { directory: '/workspace/demo' },
  }
}

function assistant(
  content: ClaraSessionMessageAssistant['content'],
  created = 1
): ClaraSessionMessageAssistant {
  return {
    id: `message-${created}`,
    type: 'assistant',
    time: { created },
    agent: 'build',
    model: { id: 'model', providerID: 'provider' },
    content,
  }
}

function todoMessage(todos: ClaraJsonValue[]): ClaraSessionMessage[] {
  return [
    assistant([
      {
        type: 'tool',
        id: 'todo',
        name: 'todowrite',
        time: { created: 1 },
        state: {
          status: 'completed',
          input: { todos },
          content: [{ type: 'text', text: 'ok' }],
        },
      },
    ]),
  ]
}

const connection = (harnessID: string, online: boolean, active: boolean) => ({
  id: `connection-${harnessID}`,
  harnessId: harnessID,
  kind: 'opencode',
  label: harnessID.toUpperCase(),
  transport: 'local' as const,
  online,
  capabilities: {},
  isActive: active,
  credentialConfigured: true,
  createdAt: 1,
  updatedAt: 1,
})

function fakeHarness(): { harness: HarnessManager; calls: string[] } {
  const calls: string[] = []
  const connections = [
    connection('harness-a', true, true),
    connection('harness-b', true, false),
    connection('harness-c', false, false),
  ]

  const harness = {
    configured: true,
    generation: 1,
    active: connections[0],
    lastError: undefined,
    harnessId: 'harness-a',
    list: () => connections,
    overlaySession: (harnessID: string, value: ClaraSession): ClaraSession =>
      harnessID === 'harness-a' ? { ...value, projectID: 'p_demo' } : value,
    requestFor: async (harnessID: string, input: { path: string }) => {
      calls.push(`${harnessID}:${input.path}`)
      if (harnessID === 'harness-a') {
        if (input.path === '/sessions/active') {
          return json({ data: { s1: { type: 'running' }, s2: { type: 'running' } } })
        }
        if (input.path === '/sessions/s1') return json({ data: session('s1') })
        if (input.path === '/sessions/s2') return json({ data: session('s2', 4) })
        if (input.path === '/sessions/s1/context') {
          return json({
            data: todoMessage([
              { content: 'Ship it', status: 'in_progress' },
              { content: 'Write docs', status: 'pending' },
            ]),
          })
        }
        if (input.path === '/sessions/s2/context') return json({ data: [] })
      }
      if (harnessID === 'harness-b') {
        if (input.path === '/sessions/active') {
          return json({ data: { s3: { type: 'running' }, s4: { type: 'running' } } })
        }
        if (input.path === '/sessions/s3') return json({ data: session('s3') })
        if (input.path === '/sessions/s4') {
          return json({ error: { code: 'upstream_error', message: 'session failed' } }, 500)
        }
        if (input.path === '/sessions/s3/context') {
          return json({ error: { code: 'upstream_error', message: 'context failed' } }, 500)
        }
      }
      return json({ error: { code: 'not_found', message: 'not found' } }, 404)
    },
  } as unknown as HarnessManager

  return { harness, calls }
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

describe('running activity', () => {
  it('lists running sessions from every online harness', async () => {
    const fake = fakeHarness()
    const api = createTestApi(fake.harness)

    const response = await api.fetch(request('/v1/activity/running'))
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      data: Array<{
        harnessID: string
        session: ClaraSession
        todos?: Array<{ content: string; status: string }>
        todosUnavailable?: boolean
      }>
      harnesses: Array<{ harnessID: string; ok: boolean; code?: string; online: boolean }>
    }

    expect(body.data.map((item) => `${item.harnessID}:${item.session.id}`)).toEqual([
      'harness-a:s2',
      'harness-a:s1',
      'harness-b:s3',
    ])
    expect(body.data[0]?.harnessID).toBe('harness-a')
    expect(body.data[0]?.session.projectID).toBe('p_demo')
    expect(body.data[1]?.todos).toEqual([
      { content: 'Ship it', status: 'in_progress' },
      { content: 'Write docs', status: 'pending' },
    ])
    expect(body.data[2]?.todosUnavailable).toBe(true)

    expect(body.harnesses).toMatchObject([
      { harnessID: 'harness-a', ok: true, online: true },
      { harnessID: 'harness-b', ok: false, code: 'partial', online: true },
      { harnessID: 'harness-c', ok: false, code: 'offline', online: false },
    ])
    expect(fake.calls.some((call) => call.startsWith('harness-c:'))).toBe(false)
  })

  it('returns an empty result when no harnesses are paired', async () => {
    const harness = {
      configured: false,
      generation: 0,
      active: undefined,
      lastError: undefined,
      harnessId: undefined,
      list: () => [],
    } as unknown as HarnessManager
    const api = createTestApi(harness)

    const response = await api.fetch(request('/v1/activity/running'))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ data: [], harnesses: [] })
  })

  it('rejects the request when harness access is disabled', async () => {
    const fake = fakeHarness()
    const deps: ApiDependencies = {
      harness: fake.harness,
      info: { version: '0.1.0', protocol: 1 },
      startedAt: 1000,
      canAccess: () => false,
      sessionCount: () => 0,
      log: () => undefined,
    }
    const api = createApiApp(deps, { token: 'secret' })

    const response = await api.fetch(request('/v1/activity/running'))
    expect(response.status).toBe(403)
    const body = (await response.json()) as { error: { code: string } }
    expect(body.error.code).toBe('disabled')
  })
})
