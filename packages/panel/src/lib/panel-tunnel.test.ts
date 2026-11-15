import { describe, expect, it } from 'vitest'
import type { PanelApiRequest } from './panel-api.ts'
import { createTunnelPanelTransport, tunnelPanelPath } from './panel-tunnel.ts'

type Call = { path: string; init: RequestInit }

function recordingFetch(): {
  calls: Call[]
  fetch: (path: string, init: RequestInit) => Promise<Response>
} {
  const calls: Call[] = []
  return {
    calls,
    fetch: async (path, init) => {
      calls.push({ path, init })
      return new Response('{}', { status: 200 })
    },
  }
}

function getRequest(path: string, headers: Record<string, string> = {}): PanelApiRequest {
  return {
    method: 'GET',
    path,
    headers: { accept: 'application/json', ...headers },
    credentials: 'same-origin',
    cache: 'no-store',
  }
}

describe('tunnel panel path', () => {
  it('rewrites the panel API prefix under the hub bridge', () => {
    expect(tunnelPanelPath('/panel/api/v1/status')).toBe('/v1/hub-panel/status')
    expect(tunnelPanelPath('/panel/api/v1')).toBe('/v1/hub-panel')
  })

  it('keeps the query string', () => {
    expect(tunnelPanelPath('/panel/api/v1/sessions?harnessID=abc&running=true')).toBe(
      '/v1/hub-panel/sessions?harnessID=abc&running=true'
    )
  })

  it('accepts a custom base path and ignores its trailing slash', () => {
    expect(tunnelPanelPath('/panel/api/v1/status', '/hub/panel/')).toBe('/hub/panel/status')
  })

  it('refuses a path the bridge does not carry', () => {
    expect(() => tunnelPanelPath('/health')).toThrow(/panel\/api\/v1/)
  })
})

describe('tunnel panel transport', () => {
  it('rewrites the request path and forwards the method, body, and guard headers', async () => {
    const { calls, fetch } = recordingFetch()
    const transport = createTunnelPanelTransport({ fetch })

    await transport({
      method: 'POST',
      path: '/panel/api/v1/features',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'x-clara-panel': '1',
      },
      body: JSON.stringify({ feature: 'relay', enabled: true }),
      credentials: 'same-origin',
      cache: 'no-store',
    })

    expect(calls).toHaveLength(1)
    expect(calls[0]?.path).toBe('/v1/hub-panel/features')
    expect(calls[0]?.init.method).toBe('POST')
    expect(calls[0]?.init.body).toBe(JSON.stringify({ feature: 'relay', enabled: true }))
    expect(calls[0]?.init.headers).toMatchObject({
      accept: 'application/json',
      'content-type': 'application/json',
      'x-clara-panel': '1',
    })
  })

  it('adds the session token as a bearer credential when one exists', async () => {
    const { calls, fetch } = recordingFetch()
    const transport = createTunnelPanelTransport({ fetch, getToken: () => 'session-token' })

    await transport(getRequest('/panel/api/v1/status'))

    expect(calls[0]?.init.headers).toMatchObject({
      accept: 'application/json',
      authorization: 'Bearer session-token',
    })
  })

  it('sends no authorization header without a token', async () => {
    for (const getToken of [undefined, () => null, () => undefined, () => '']) {
      const { calls, fetch } = recordingFetch()
      const transport = createTunnelPanelTransport({ fetch, ...(getToken ? { getToken } : {}) })

      await transport(getRequest('/panel/api/v1/session'))

      const headers = calls[0]?.init.headers as Record<string, string>
      expect(headers.authorization).toBeUndefined()
      expect(headers.accept).toBe('application/json')
    }
  })

  it('reads the token per request so a fresh sign-in is used immediately', async () => {
    const { calls, fetch } = recordingFetch()
    let token: string | null = null
    const transport = createTunnelPanelTransport({ fetch, getToken: () => token })

    await transport(getRequest('/panel/api/v1/status'))
    token = 'fresh'
    await transport(getRequest('/panel/api/v1/status'))

    const headers = calls.map((call) => (call.init.headers as Record<string, string>).authorization)
    expect(headers).toEqual([undefined, 'Bearer fresh'])
  })

  it('forwards the abort signal', async () => {
    const { calls, fetch } = recordingFetch()
    const controller = new AbortController()
    const transport = createTunnelPanelTransport({ fetch })

    await transport({ ...getRequest('/panel/api/v1/status'), signal: controller.signal })

    expect(calls[0]?.init.signal).toBe(controller.signal)
  })

  it('honours a custom base path', async () => {
    const { calls, fetch } = recordingFetch()
    const transport = createTunnelPanelTransport({ fetch, basePath: '/hub/panel' })

    await transport(getRequest('/panel/api/v1/install?kind=opencode'))

    expect(calls[0]?.path).toBe('/hub/panel/install?kind=opencode')
  })
})
