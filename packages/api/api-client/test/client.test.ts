import { describe, expect, it } from 'vitest'
import { createClaraClient, ClaraApiError } from '../src/index.ts'

type Recorded = {
  method: string
  url: string
  headers: Headers
  body?: string
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function fakeFetch(handler: (request: Request) => Response | Promise<Response>): {
  fetch: typeof globalThis.fetch
  requests: Recorded[]
} {
  const requests: Recorded[] = []
  const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init)
    requests.push({
      method: request.method,
      url: request.url,
      headers: request.headers,
      ...(typeof init?.body === 'string' ? { body: init.body } : {}),
    })
    return handler(request)
  }
  return { fetch: fetch as typeof globalThis.fetch, requests }
}

describe('Clara API client', () => {
  it('lists projects with query parameters', async () => {
    const fake = fakeFetch(() => json([{ id: 'p1' }]))
    const client = createClaraClient({ fetch: fake.fetch })

    await expect(client.project.list({ archived: true })).resolves.toEqual([{ id: 'p1' }])
    expect(fake.requests[0]?.url).toBe('http://clara.api/v1/projects?archived=true')
  })

  it('reads inbox and outbox activity across paired harnesses', async () => {
    const fake = fakeFetch(() => json({ data: [], harnesses: [] }))
    const client = createClaraClient({ fetch: fake.fetch })

    await expect(client.activity.sessions()).resolves.toEqual({ data: [], harnesses: [] })
    expect(fake.requests[0]?.method).toBe('GET')
    expect(fake.requests[0]?.url).toBe('http://clara.api/v1/activity/sessions')

    await client.activity.sessions({ refresh: true })
    expect(fake.requests[1]?.url).toBe('http://clara.api/v1/activity/sessions?refresh=true')
  })

  it('sends a prompt to the session endpoint', async () => {
    const fake = fakeFetch(() => json({ id: 'inbox-1' }))
    const client = createClaraClient({ fetch: fake.fetch })

    await client.session.prompt({ sessionID: 's/1', text: 'hello', delivery: 'steer' })

    expect(fake.requests[0]?.method).toBe('POST')
    expect(fake.requests[0]?.url).toBe('http://clara.api/v1/sessions/s%2F1/prompt')
    expect(JSON.parse(fake.requests[0]?.body ?? '{}')).toEqual({
      text: 'hello',
      delivery: 'steer',
    })
  })

  it('cancels a form with a DELETE body', async () => {
    const fake = fakeFetch(() => new Response(null, { status: 204 }))
    const client = createClaraClient({ fetch: fake.fetch })

    await expect(
      client.session.form.cancel({ sessionID: 's1', formID: 'f1', message: 'no' })
    ).resolves.toBeUndefined()

    expect(fake.requests[0]?.method).toBe('DELETE')
    expect(fake.requests[0]?.url).toBe('http://clara.api/v1/sessions/s1/forms/f1')
    expect(JSON.parse(fake.requests[0]?.body ?? '{}')).toEqual({ message: 'no' })
  })

  it('maps VCS diff and Git log to read-only GET requests', async () => {
    const fake = fakeFetch(() => json({ data: [] }))
    const client = createClaraClient({ fetch: fake.fetch })

    await client.vcs.diff({
      location: { directory: '/repo' },
      mode: 'working',
      context: 0,
    })
    await client.git.log({ directory: '/repo', since: 1, until: 2 })

    expect(fake.requests[0]?.method).toBe('GET')
    expect(fake.requests[0]?.url).toBe(
      'http://clara.api/v1/vcs/diff?directory=%2Frepo&mode=working&context=0'
    )
    expect(fake.requests[1]?.url).toBe(
      'http://clara.api/v1/git/log?directory=%2Frepo&since=1&until=2'
    )
  })

  it('returns undefined for a no-content response', async () => {
    const fake = fakeFetch(() => new Response(null, { status: 204 }))
    const client = createClaraClient({ fetch: fake.fetch })

    await expect(client.session.remove({ sessionID: 's1' })).resolves.toBeUndefined()
  })

  it('throws a typed error for API failures', async () => {
    const fake = fakeFetch(() => json({ error: { code: 'not_found', message: 'missing' } }, 404))
    const client = createClaraClient({ fetch: fake.fetch })

    await expect(client.session.get({ sessionID: 's1' })).rejects.toMatchObject({
      name: 'ClaraApiError',
      status: 404,
      code: 'not_found',
      message: 'missing',
    })
    await expect(client.session.get({ sessionID: 's1' })).rejects.toBeInstanceOf(ClaraApiError)
  })

  it('reads hub status from the info endpoint', async () => {
    const fake = fakeFetch(() => json({ api: { version: 'v1' } }))
    const client = createClaraClient({ fetch: fake.fetch })

    await expect(client.server.status()).resolves.toEqual({ api: { version: 'v1' } })
    expect(fake.requests[0]?.url).toBe('http://clara.api/v1/info')
  })

  it('passes an abort signal to the transport', async () => {
    const controller = new AbortController()
    let seen: AbortSignal | undefined
    const fake = fakeFetch((request) => {
      seen = request.signal
      return json({ id: 'p1' })
    })
    const client = createClaraClient({ fetch: fake.fetch })

    await client.session.get({ sessionID: 's1' }, { signal: controller.signal })
    controller.abort()
    expect(seen?.aborted).toBe(true)
  })
})
