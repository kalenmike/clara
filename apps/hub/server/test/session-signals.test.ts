import { describe, expect, it } from 'vitest'
import type { ClaraForm, ClaraSession, ClaraSessionMessage } from '@clara/api-contract'
import { createApiApp } from '../src/api/app.ts'
import type { ApiDependencies } from '../src/api/context.ts'
import { SessionSignalsService } from '../src/activity/session-signals.ts'
import type { HarnessManager } from '../src/harness/manager.ts'
import type { HarnessRequest } from '../src/harness/types.ts'
import { loadSessionAttention } from '../src/push/attention.ts'

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

type HarnessOptions = {
  owners?: Record<string, string>
  online?: string[]
  forms?: Record<string, ClaraForm[]>
  fail?: Set<string>
}

type SignalBody = {
  data: Array<{
    sessionID: string
    signals: {
      last: 'user' | 'assistant' | 'none'
      awaitingInput: boolean
      lastError: boolean
      planReply: boolean
    }
  }>
}

function userMessage(created = 2): ClaraSessionMessage {
  return {
    id: `user-${created}`,
    type: 'user',
    time: { created },
    text: 'hello',
  }
}

function assistantMessage(
  options: { created?: number; finish?: string } = {}
): ClaraSessionMessage {
  return {
    id: 'assistant-1',
    type: 'assistant',
    time: { created: options.created ?? 2 },
    agent: 'build',
    model: { id: 'model', providerID: 'provider' },
    content: [],
    finish: (options.finish ?? 'stop') as 'stop',
  }
}

function form(sessionID: string): ClaraForm {
  return {
    id: `form-${sessionID}`,
    sessionID,
    title: 'Pick one',
    fields: [{ key: 'answer', type: 'string', title: 'Answer' }],
  }
}

function session(id: string): ClaraSession {
  return {
    id,
    projectID: 'p1',
    agent: 'build',
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 1, updated: 2 },
    title: `Session ${id}`,
    location: { directory: '/workspace' },
  }
}

function fakeHarness(options: HarnessOptions = {}) {
  const calls: string[] = []
  const owners = options.owners ?? { s1: 'harness-a', s2: 'harness-a' }
  const online = new Set(options.online ?? ['harness-a'])
  const forms = options.forms ?? {}
  const fail = options.fail ?? new Set<string>()

  const harness = {
    configured: true,
    generation: 1,
    list: () => [...online].map((harnessId) => ({ harnessId, online: true })),
    connection: (harnessID: string) =>
      online.has(harnessID) ? { harnessId: harnessID } : undefined,
    metadata: {
      harnessIdForSession: (sessionID: string) => owners[sessionID],
    },
    requestFor: async (harnessID: string, input: { path: string; search?: string }) => {
      calls.push(`${harnessID}:${input.path}`)
      const search = new URLSearchParams(
        input.search?.startsWith('?') ? input.search.slice(1) : input.search
      )
      const single = /^\/sessions\/([^/]+)$/.exec(input.path)
      if (single) return json(session(single[1]!))
      const match = /^\/sessions\/([^/]+)\/(messages|forms)$/.exec(input.path)
      if (!match) return json({ error: { code: 'not_found', message: 'not found' } }, 404)
      const [, sessionID, endpoint] = match
      if (endpoint === 'forms') {
        // Adapters return the pending forms as a bare array, not an envelope.
        return json(forms[sessionID!] ?? [])
      }
      if (fail.has(sessionID!)) {
        return json({ error: { code: 'upstream_error', message: 'boom' } }, 500)
      }
      const type = search.get('type')
      if (type === 'user') return json({ data: [userMessage()] })
      if (type === 'assistant') return json({ data: [assistantMessage()] })
      return json({ data: [] })
    },
  } as unknown as HarnessManager

  return { harness, calls }
}

function harnessClient(harness: HarnessManager, harnessID: string): HarnessRequest {
  return {
    request: (input, signal) => harness.requestFor(harnessID, input, signal),
  }
}

function testDependencies(harness: HarnessManager): ApiDependencies {
  return {
    harness,
    info: { version: '0.1.0', protocol: 1 },
    startedAt: 1000,
    canAccess: () => true,
    sessionCount: () => 0,
    log: () => undefined,
  }
}

function createTestApi(harness: HarnessManager) {
  return createApiApp(testDependencies(harness), { token: 'secret' })
}

function request(path: string): Request {
  return new Request(`http://clara.local${path}`, {
    headers: { authorization: 'Bearer secret' },
  })
}

describe('session signals', () => {
  it('answers many sessions in one request and omits unknown or offline owners', async () => {
    const fake = fakeHarness({
      owners: { s1: 'harness-a', s2: 'harness-a', offline: 'harness-b' },
      online: ['harness-a'],
      forms: { s1: [form('s1')] },
    })
    const api = createTestApi(fake.harness)

    const response = await api.fetch(
      request('/v1/sessions/signals?sessions=s1@10,s2@20,unknown@30,offline@40')
    )
    expect(response.status).toBe(200)
    const body = (await response.json()) as SignalBody

    expect(body.data.map((entry) => entry.sessionID)).toEqual(['s1', 's2'])
    expect(body.data[0]?.signals).toEqual({
      last: 'assistant',
      awaitingInput: true,
      lastError: false,
      planReply: false,
    })
    expect(body.data[1]?.signals).toEqual({
      last: 'assistant',
      awaitingInput: false,
      lastError: false,
      planReply: false,
    })
    // Three harness reads per resolved session, never one per unknown session.
    expect(fake.calls.filter((call) => call.startsWith('harness-a:'))).toHaveLength(6)
  })

  it('reuses cached signals until the session updated stamp changes', async () => {
    const fake = fakeHarness()
    const signals = new SessionSignalsService(testDependencies(fake.harness))

    await signals.forSession('harness-a', 's1', 10)
    expect(fake.calls).toHaveLength(3)

    await signals.forSession('harness-a', 's1', 10)
    expect(fake.calls).toHaveLength(3)

    await signals.forSession('harness-a', 's1', 11)
    expect(fake.calls).toHaveLength(6)
  })

  it('coalesces concurrent reads for the same session', async () => {
    const fake = fakeHarness({ owners: { s1: 'harness-a' } })
    const api = createTestApi(fake.harness)

    const [first, second] = await Promise.all([
      api.fetch(request('/v1/sessions/signals?sessions=s1@10')),
      api.fetch(request('/v1/sessions/signals?sessions=s1@10')),
    ])

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(fake.calls).toHaveLength(3)
  })

  it('keeps the rest of a batch when one session fails', async () => {
    const fake = fakeHarness({ fail: new Set(['s2']) })
    const api = createTestApi(fake.harness)

    const response = await api.fetch(request('/v1/sessions/signals?sessions=s1@10,s2@20'))
    expect(response.status).toBe(200)
    const body = (await response.json()) as SignalBody
    expect(body.data.map((entry) => entry.sessionID)).toEqual(['s1'])
  })

  it('rejects a malformed or oversized batch', async () => {
    const fake = fakeHarness()
    const api = createTestApi(fake.harness)

    const malformed = await api.fetch(request('/v1/sessions/signals?sessions=s1'))
    expect(malformed.status).toBe(400)

    const ids = Array.from({ length: 101 }, (_, index) => `s${index}@1`).join(',')
    const oversized = await api.fetch(request(`/v1/sessions/signals?sessions=${ids}`))
    expect(oversized.status).toBe(400)
  })
})

describe('session attention', () => {
  it('reads a bare session body and reports a pending question', async () => {
    const fake = fakeHarness({ owners: { s1: 'harness-a' }, forms: { s1: [form('s1')] } })

    const attention = await loadSessionAttention(harnessClient(fake.harness, 'harness-a'), 's1')

    expect(attention?.kind).toBe('question')
    expect(attention?.session.id).toBe('s1')
  })

  it('returns no attention when the harness has no session', async () => {
    const client: HarnessRequest = {
      request: async () => json({ error: { code: 'not_found', message: 'not found' } }, 404),
    }

    expect(await loadSessionAttention(client, 'missing')).toBeNull()
  })
})
