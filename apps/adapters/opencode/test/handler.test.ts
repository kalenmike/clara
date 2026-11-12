import { describe, expect, it, vi } from 'vitest'
import { createAdapterApp } from '../src/handler.ts'
import { OpenCodeGateway } from '../src/opencode.ts'
import { createFakeFetch, emptyResponse, jsonResponse } from './fake-opencode.ts'

const INFO = {
  adapter: { name: 'opencode', version: '0.1.0' },
  harness: { kind: 'opencode', version: '2.1.1' },
  capabilities: { sessions: true },
}

const SESSION = {
  id: 's1',
  projectID: 'p1',
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 1, updated: 2 },
  location: { directory: '/repo' },
}

describe('adapter handler', () => {
  it('archives every session in a project record', async () => {
    const { fetch, requests } = createFakeFetch((request) => {
      if (request.method === 'GET') return jsonResponse({ data: [SESSION], cursor: {} })
      return emptyResponse(204)
    })
    const app = createApp(fetch)

    const response = await app.request('/harness/v1/projects/p1/archive', { method: 'POST' })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ affected: 1 })
    expect(requests[0]?.method).toBe('GET')
    expect(requests[0]?.url.pathname).toBe('/api/session')
    expect(requests[0]?.url.searchParams.get('project')).toBe('p1')
    expect(requests[0]?.url.searchParams.get('archived')).toBe('false')
    expect(requests[1]?.method).toBe('PATCH')
    expect(requests[1]?.url.pathname).toBe('/api/session/s1')
  })

  it('deletes every session in a project record', async () => {
    const { fetch, requests } = createFakeFetch((request) => {
      if (request.method === 'GET') return jsonResponse({ data: [SESSION], cursor: {} })
      return emptyResponse(204)
    })
    const app = createApp(fetch)

    const response = await app.request('/harness/v1/projects/p1', { method: 'DELETE' })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ affected: 1 })
    expect(requests[0]?.url.searchParams.get('archived')).toBeNull()
    expect(requests[1]?.method).toBe('DELETE')
    expect(requests[1]?.url.pathname).toBe('/api/session/s1')
  })

  it('returns adapter info without touching OpenCode', async () => {
    const { fetch, requests } = createFakeFetch(() => jsonResponse({}))
    const app = createApp(fetch)

    const response = await app.request('/harness/v1/info')

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      protocol: 1,
      ...INFO,
    })
    expect(requests).toHaveLength(0)
  })

  it('returns the live health probe', async () => {
    const { fetch } = createFakeFetch(() =>
      jsonResponse({ version: '2.1.1', pid: 1, urls: [], paths: { tmp: '/tmp' } })
    )
    const app = createApp(fetch)

    const response = await app.request('/harness/v1/health')

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ok: true, code: 'ok', version: '2.1.1' })
  })

  it('maps session query parameters into the typed SDK call', async () => {
    const { fetch, requests } = createFakeFetch(() => jsonResponse({ data: [SESSION], cursor: {} }))
    const app = createApp(fetch)

    const response = await app.request('/harness/v1/sessions?project=p1&limit=5&archived=true')

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ data: [SESSION], cursor: {} })
    expect(requests[0]?.url.pathname).toBe('/api/session')
    expect(requests[0]?.url.searchParams.get('project')).toBe('p1')
    expect(requests[0]?.url.searchParams.get('limit')).toBe('5')
    expect(requests[0]?.url.searchParams.get('archived')).toBe('true')
  })

  it('maps a location-scoped file find request', async () => {
    const files = {
      location: { directory: '/repo' },
      data: [{ path: 'src/index.ts', type: 'file' }],
    }
    const { fetch, requests } = createFakeFetch(() => jsonResponse(files))
    const app = createApp(fetch)

    const response = await app.request(
      '/harness/v1/files/find?directory=%2Frepo&query=index&type=file&limit=5'
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(files)
    expect(requests[0]?.url.pathname).toBe('/api/fs/find')
    expect(requests[0]?.url.searchParams.get('location[directory]')).toBe('/repo')
    expect(requests[0]?.url.searchParams.get('query')).toBe('index')
    expect(requests[0]?.url.searchParams.get('type')).toBe('file')
    expect(requests[0]?.url.searchParams.get('limit')).toBe('5')
  })

  it('prompts through the typed session route', async () => {
    const inbox = {
      id: 'inbox1',
      sessionID: 's1',
      time: { created: 1 },
      type: 'user',
      payload: { text: 'hello' },
      delivery: 'queue',
    }
    const { fetch, requests } = createFakeFetch(() => jsonResponse({ data: inbox }))
    const app = createApp(fetch)

    const response = await app.request('/harness/v1/sessions/s1/prompt', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'hello' }),
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(inbox)
    expect(requests[0]?.method).toBe('POST')
    expect(requests[0]?.url.pathname).toBe('/api/session/s1/prompt')
    expect(JSON.parse(requests[0]?.body ?? '{}')).toEqual({ text: 'hello' })
  })

  it('streams SDK events as SSE and cancels the upstream subscription', async () => {
    const encoder = new TextEncoder()
    const event = { id: 'e1', created: 1, type: 'session.idle', data: { sessionID: 's1' } }
    let upstreamSignal: AbortSignal | undefined
    let streamController: ReadableStreamDefaultController<Uint8Array> | undefined
    let resolveStream!: () => void
    const streamStarted = new Promise<void>((resolve) => {
      resolveStream = resolve
    })
    const { fetch } = createFakeFetch((request) => {
      upstreamSignal = request.signal
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            streamController = controller
            resolveStream()
          },
        }),
        { status: 200, headers: { 'content-type': 'text/event-stream' } }
      )
    })
    const app = createApp(fetch)
    const controller = new AbortController()

    const response = await app.request('/harness/v1/events', { signal: controller.signal })
    expect(response.headers.get('content-type')).toBe('text/event-stream')
    const reader = response.body?.getReader()
    if (!reader) throw new Error('Expected an event stream')

    const decoder = new TextDecoder()
    expect(decoder.decode((await reader.read()).value)).toBe(':\n\n')
    await streamStarted
    streamController?.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
    expect(decoder.decode((await reader.read()).value)).toBe(`data: ${JSON.stringify(event)}\n\n`)

    controller.abort()
    await vi.waitFor(() => expect(upstreamSignal?.aborted).toBe(true))
    await reader.cancel().catch(() => undefined)
  })

  it('runs git log through the SDK shell methods and cleans up', async () => {
    const record = [
      'abc1234',
      'Ada',
      'ada@example.com',
      '2026-01-01T00:00:00.000Z',
      'feat: one',
      'body',
    ].join('\x1f')
    const { fetch, requests } = createFakeFetch((request) => {
      if (request.url.pathname === '/api/shell' && request.method === 'POST') {
        return jsonResponse({
          location: { directory: '/repo' },
          data: shell({ status: 'running' }),
        })
      }
      if (request.url.pathname === '/api/shell/sh1' && request.method === 'GET') {
        return jsonResponse({
          location: { directory: '/repo' },
          data: shell({ status: 'exited', exit: 0 }),
        })
      }
      if (request.url.pathname === '/api/shell/sh1/output') {
        return jsonResponse({
          location: { directory: '/repo' },
          data: { output: `${record}\x1e`, cursor: 0, size: 1, truncated: false },
        })
      }
      if (request.url.pathname === '/api/shell/sh1' && request.method === 'DELETE') {
        return emptyResponse()
      }
      return jsonResponse({ message: 'unexpected request' }, 500)
    })
    const app = createApp(fetch)

    const response = await app.request('/harness/v1/git/log?directory=%2Frepo&since=1')

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual([
      {
        hash: 'abc1234',
        authorName: 'Ada',
        authorEmail: 'ada@example.com',
        authoredAt: '2026-01-01T00:00:00.000Z',
        subject: 'feat: one',
        body: 'body',
      },
    ])
    expect(requests.map((request) => `${request.method} ${request.url.pathname}`)).toEqual([
      'POST /api/shell',
      'GET /api/shell/sh1',
      'GET /api/shell/sh1/output',
      'DELETE /api/shell/sh1',
    ])
    expect(requests[0]?.body).toContain('git log')
  })

  it('cleans up the shell even when git log fails', async () => {
    const { fetch, requests } = createFakeFetch((request) => {
      if (request.url.pathname === '/api/shell') {
        return jsonResponse({
          location: { directory: '/repo' },
          data: shell({ status: 'exited', exit: 1 }),
        })
      }
      if (request.url.pathname === '/api/shell/sh1/output') {
        return jsonResponse({
          location: { directory: '/repo' },
          data: { output: 'fatal: bad revision\n', cursor: 0, size: 1, truncated: false },
        })
      }
      if (request.url.pathname === '/api/shell/sh1') return emptyResponse()
      return jsonResponse({ message: 'unexpected request' }, 500)
    })
    const app = createApp(fetch)

    const response = await app.request('/harness/v1/git/log?directory=%2Frepo&since=1')

    expect(response.status).toBe(500)
    expect(requests.some((request) => request.method === 'DELETE')).toBe(true)
  })
})

function createApp(fetch: typeof globalThis.fetch) {
  return createAdapterApp({
    opencode: new OpenCodeGateway({ url: 'http://opencode.test', fetch }),
    info: INFO,
  })
}

function shell(input: { status: 'running' | 'exited'; exit?: number }) {
  return {
    id: 'sh1',
    status: input.status,
    command: 'git log',
    cwd: '/repo',
    shell: 'bash',
    file: '/tmp/shell',
    metadata: {},
    time: { started: 1 },
    ...(input.exit === undefined ? {} : { exit: input.exit }),
  }
}
