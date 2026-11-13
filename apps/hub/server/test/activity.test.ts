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

type SessionOptions = {
  created?: number
  updated?: number
  archived?: number
  snoozed?: boolean
  automation?: boolean
}

function session(id: string, options: SessionOptions = {}): ClaraSession {
  return {
    id,
    projectID: 'hp1',
    cost: 0.5,
    tokens: { input: 100, output: 20, reasoning: 0, cache: { read: 10, write: 2 } },
    time: {
      created: options.created ?? 1,
      updated: options.updated ?? options.created ?? 1,
      ...(options.archived !== undefined ? { archived: options.archived } : {}),
    },
    ...(options.snoozed || options.automation
      ? {
          metadata: {
            ...(options.snoozed ? { snoozed: true } : {}),
            ...(options.automation ? { automation: true } : {}),
          },
        }
      : {}),
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

function message(type: 'user' | 'assistant', created: number) {
  return {
    id: `${type}-${created}`,
    type,
    time: { created },
    ...(type === 'assistant'
      ? {
          agent: 'build',
          model: { id: 'model', providerID: 'provider' },
          content: [],
          finish: 'stop',
        }
      : { content: [{ type: 'text', text: 'hello' }] }),
  }
}

const connection = (harnessID: string, online: boolean, active: boolean, createdAt: number) => ({
  id: `connection-${harnessID}`,
  harnessId: harnessID,
  kind: 'opencode',
  label: harnessID.toUpperCase(),
  transport: 'local' as const,
  online,
  capabilities: {},
  isActive: active,
  credentialConfigured: true,
  createdAt,
  updatedAt: 1,
})

type LastAuthor = 'user' | 'assistant' | 'none'

type FakeHarness = {
  harness: HarnessManager
  calls: string[]
  setTodos: (sessionID: string, todos: ClaraJsonValue[]) => void
  failSignals: (sessionID: string, fail: boolean) => void
}

function fakeHarness(options: { extraSessions?: number } = {}): FakeHarness {
  const calls: string[] = []
  const todos = new Map<string, ClaraJsonValue[]>([
    [
      's1',
      [
        { content: 'Ship it', status: 'in_progress' },
        { content: 'Write docs', status: 'pending' },
      ],
    ],
  ])
  const failedSignals = new Set<string>()
  const lastAuthors = new Map<string, LastAuthor>([
    ['s1', 'user'],
    ['s2', 'assistant'],
    ['s3', 'user'],
    ['s4', 'assistant'],
    ['s5', 'assistant'],
    ['s6', 'none'],
    ['s7', 'assistant'],
    ['s8', 'assistant'],
    ['s10', 'user'],
    ['s11', 'user'],
    ['s12', 'assistant'],
  ])
  const sessions = new Map<string, ClaraSession[]>([
    [
      'harness-a',
      [
        session('s1', { created: 10 }),
        session('s2', { created: 20 }),
        session('s3', { created: 30 }),
        session('s4', { created: 40, snoozed: true }),
        session('s5', { created: 50, archived: 1 }),
        session('s6', { created: 60 }),
        session('s7', { created: 70, automation: true }),
        session('s10', { created: 80 }),
      ],
    ],
    [
      'harness-b',
      [
        session('s8', { created: 5 }),
        session('s11', { created: 15 }),
        session('s12', { created: 25 }),
      ],
    ],
  ])
  const harnessA = sessions.get('harness-a')!
  for (let index = 0; index < (options.extraSessions ?? 0); index += 1) {
    const id = `extra-${index}`
    harnessA.push(session(id, { created: 100 + index }))
    lastAuthors.set(id, 'assistant')
  }
  const connections = [
    connection('harness-a', true, true, 2),
    connection('harness-b', true, false, 1),
    connection('harness-c', false, false, 3),
  ]
  const permissions = [
    {
      id: 'permission-s3',
      sessionID: 's3',
      action: 'bash',
      resources: ['rm -rf build'],
    },
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
    requestFor: async (harnessID: string, input: { path: string; search?: string }) => {
      calls.push(`${harnessID}:${input.path}`)
      const search = new URLSearchParams(
        input.search?.startsWith('?') ? input.search.slice(1) : input.search
      )
      if (harnessID === 'harness-a') {
        if (input.path === '/sessions/active') {
          return json({ data: { s1: { type: 'running' }, s7: { type: 'running' } } })
        }
        if (input.path === '/permissions') {
          return json({ location: { directory: '/workspace/demo' }, data: permissions })
        }
        if (input.path === '/sessions') {
          const list = sessions.get(harnessID) ?? []
          const page = search.get('cursor')
          if (page === 'page-2') {
            return json({
              data: list.slice(4),
              cursor: { previous: 'page-1', next: null },
            })
          }
          return json({
            data: list.slice(0, 4),
            cursor: { previous: null, next: 'page-2' },
          })
        }
        const match = /^\/sessions\/([^/]+)\/(messages|forms|context)$/.exec(input.path)
        if (match) {
          const [, sessionID, endpoint] = match
          if (endpoint === 'messages') {
            if (failedSignals.has(sessionID!)) {
              return json({ error: { code: 'upstream_error', message: 'messages failed' } }, 500)
            }
            const limit = Number(search.get('limit') ?? '0')
            if (limit > 1) {
              return json({
                data: todos.has(sessionID!) ? todoMessage(todos.get(sessionID!)!) : [],
                cursor: { previous: null, next: null },
              })
            }
            const last = lastAuthors.get(sessionID!) ?? 'none'
            const type = search.get('type')
            if (last === 'none' || (type === 'user' && last === 'assistant')) {
              return json({ data: [] })
            }
            if (type === 'assistant' && last === 'assistant') {
              return json({ data: [message('assistant', 2)] })
            }
            if (type === 'user') {
              return json({ data: [message('user', last === 'user' ? 2 : 1)] })
            }
            return json({ data: [] })
          }
          if (endpoint === 'forms') return json({ data: [] })
        }
      }
      if (harnessID === 'harness-b') {
        if (input.path === '/sessions/active') return json({ data: {} })
        if (input.path === '/permissions') {
          return json({ location: { directory: '/workspace/demo' }, data: [] })
        }
        if (input.path === '/sessions') {
          return json({
            data: sessions.get(harnessID) ?? [],
            cursor: { previous: null, next: null },
          })
        }
        const match = /^\/sessions\/([^/]+)\/(messages|forms|context)$/.exec(input.path)
        if (match) {
          const [, sessionID, endpoint] = match
          calls.push(`${harnessID}:${sessionID}:${endpoint}`)
          if (endpoint === 'messages') {
            if (failedSignals.has(sessionID!)) {
              return json({ error: { code: 'upstream_error', message: 'messages failed' } }, 500)
            }
            const limit = Number(search.get('limit') ?? '0')
            if (limit > 1) {
              return json({
                data: todos.has(sessionID!) ? todoMessage(todos.get(sessionID!)!) : [],
                cursor: { previous: null, next: null },
              })
            }
            const last = lastAuthors.get(sessionID!) ?? 'none'
            const type = search.get('type')
            if (last === 'none' || (type === 'user' && last === 'assistant')) {
              return json({ data: [] })
            }
            if (type === 'assistant' && last === 'assistant') {
              return json({ data: [message('assistant', 2)] })
            }
            if (type === 'user') {
              return json({ data: [message('user', last === 'user' ? 2 : 1)] })
            }
            return json({ data: [] })
          }
          if (endpoint === 'forms') return json({ data: [] })
          return json({ data: [] })
        }
      }
      return json({ error: { code: 'not_found', message: 'not found' } }, 404)
    },
  } as unknown as HarnessManager

  return {
    harness,
    calls,
    setTodos: (sessionID, next) => {
      todos.set(sessionID, next)
    },
    failSignals: (sessionID, fail) => {
      if (fail) failedSignals.add(sessionID)
      else failedSignals.delete(sessionID)
    },
  }
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

type ActivityBody = {
  data: Array<{
    harnessID: string
    session: ClaraSession
    mailbox: 'inbox' | 'outbox'
    todos?: Array<{ content: string; status: string }>
    todosUnavailable?: boolean
    todosSkipped?: boolean
  }>
  harnesses: Array<{
    harnessID: string
    ok: boolean
    code?: string
    online: boolean
    createdAt: number
  }>
}

describe('activity sessions', () => {
  it('lists inbox and outbox sessions from every online harness in a stable order', async () => {
    const fake = fakeHarness()
    const api = createTestApi(fake.harness)

    const response = await api.fetch(request('/v1/activity/sessions'))
    expect(response.status).toBe(200)
    const body = (await response.json()) as ActivityBody

    expect(body.data.map((item) => `${item.harnessID}:${item.session.id}`)).toEqual([
      'harness-b:s8',
      'harness-b:s11',
      'harness-b:s12',
      'harness-a:s1',
      'harness-a:s2',
      'harness-a:s3',
      'harness-a:s7',
      'harness-a:s10',
    ])
    expect(body.data.map((item) => `${item.session.id}:${item.mailbox}`)).toEqual([
      's8:inbox',
      's11:outbox',
      's12:inbox',
      's1:outbox',
      's2:inbox',
      's3:inbox',
      's7:outbox',
      's10:outbox',
    ])
    expect(body.data[0]?.session.projectID).toBe('hp1')
    expect(body.data.find((item) => item.session.id === 's1')?.session.projectID).toBe('p_demo')
    expect(body.data.find((item) => item.session.id === 's1')?.todos).toEqual([
      { content: 'Ship it', status: 'in_progress' },
      { content: 'Write docs', status: 'pending' },
    ])
    expect(body.data.find((item) => item.session.id === 's7')?.mailbox).toBe('outbox')
    expect(body.data.some((item) => item.session.id === 's4')).toBe(false)
    expect(body.data.some((item) => item.session.id === 's5')).toBe(false)
    expect(body.data.some((item) => item.session.id === 's6')).toBe(false)

    expect(body.harnesses).toMatchObject([
      { harnessID: 'harness-b', ok: true, online: true, createdAt: 1 },
      { harnessID: 'harness-a', ok: true, online: true, createdAt: 2 },
      { harnessID: 'harness-c', ok: false, code: 'offline', online: false, createdAt: 3 },
    ])
    expect(fake.calls.some((call) => call.startsWith('harness-c:'))).toBe(false)
  })

  it('caps plan loading while keeping every session and its position', async () => {
    const fake = fakeHarness({ extraSessions: 60 })
    const api = createTestApi(fake.harness)

    const body = (await (await api.fetch(request('/v1/activity/sessions'))).json()) as ActivityBody

    expect(body.data.length).toBeGreaterThan(60)
    expect(body.data.some((item) => item.todosSkipped)).toBe(true)
    expect(
      body.data.filter((item) => item.mailbox === 'outbox').every((item) => !item.todosSkipped)
    ).toBe(true)
    expect(
      body.data.every(
        (item, index) =>
          index === 0 ||
          item.session.time.created >= body.data[index - 1]!.session.time.created ||
          item.harnessID !== body.data[index - 1]!.harnessID
      )
    ).toBe(true)
  })

  it('bypasses signal and plan caches for a manual refresh', async () => {
    const fake = fakeHarness()
    const api = createTestApi(fake.harness)
    const first = (await (await api.fetch(request('/v1/activity/sessions'))).json()) as ActivityBody
    expect(first.data.find((item) => item.session.id === 's1')?.todos).toEqual([
      { content: 'Ship it', status: 'in_progress' },
      { content: 'Write docs', status: 'pending' },
    ])

    fake.setTodos('s1', [{ content: 'Finished', status: 'completed' }])
    const cached = (await (
      await api.fetch(request('/v1/activity/sessions'))
    ).json()) as ActivityBody
    expect(cached.data.find((item) => item.session.id === 's1')?.todos).toEqual([
      { content: 'Ship it', status: 'in_progress' },
      { content: 'Write docs', status: 'pending' },
    ])

    const refreshed = (await (
      await api.fetch(request('/v1/activity/sessions?refresh=true'))
    ).json()) as ActivityBody
    expect(refreshed.data.find((item) => item.session.id === 's1')?.todos).toEqual([
      { content: 'Finished', status: 'completed' },
    ])
  })

  it('marks a harness partial when a session cannot be classified', async () => {
    const fake = fakeHarness()
    fake.failSignals('s8', true)
    const api = createTestApi(fake.harness)

    const body = (await (await api.fetch(request('/v1/activity/sessions'))).json()) as ActivityBody

    expect(body.harnesses).toMatchObject([
      { harnessID: 'harness-b', ok: false, code: 'partial', online: true },
      { harnessID: 'harness-a', ok: true, online: true },
      { harnessID: 'harness-c', ok: false, code: 'offline', online: false },
    ])
    expect(body.data.find((item) => item.session.id === 's8')?.mailbox).toBe('inbox')
  })

  it('keeps only running sessions on the deprecated running route', async () => {
    const fake = fakeHarness()
    const api = createTestApi(fake.harness)

    const body = (await (await api.fetch(request('/v1/activity/running'))).json()) as ActivityBody

    expect(body.data.map((item) => item.session.id)).toEqual(['s1', 's7'])
    expect(body.data.every((item) => item.mailbox === 'outbox')).toBe(true)
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

    const response = await api.fetch(request('/v1/activity/sessions'))
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

    const response = await api.fetch(request('/v1/activity/sessions'))
    expect(response.status).toBe(403)
    const body = (await response.json()) as { error: { code: string } }
    expect(body.error.code).toBe('disabled')
  })
})
