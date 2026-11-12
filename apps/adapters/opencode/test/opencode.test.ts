import { OpenCode } from '@opencode/client'
import type { OpenCodeClient } from '@opencode/client'
import { describe, expect, expectTypeOf, it } from 'vitest'
import { AdapterError } from '../src/errors.ts'
import { OpenCodeGateway, toAdapterError } from '../src/opencode.ts'
import { createFakeFetch, jsonResponse } from './fake-opencode.ts'

const BASE_URL = 'http://127.0.0.1:4096'

describe('OpenCodeGateway.probe', () => {
  it('reports the server version and latency', async () => {
    const { fetch } = createFakeFetch(() =>
      jsonResponse({ version: '2.1.1', pid: 1, urls: [], paths: { tmp: '/tmp' } })
    )
    const gateway = new OpenCodeGateway({ url: BASE_URL, fetch })

    const probe = await gateway.probe()

    expect(probe.ok).toBe(true)
    expect(probe.code).toBe('ok')
    expect(probe.version).toBe('2.1.1')
    expect(probe.latencyMs).toBeGreaterThanOrEqual(0)
  })

  it('sends the configured basic-auth header', async () => {
    const { fetch, requests } = createFakeFetch(() =>
      jsonResponse({ version: '2.1.1', pid: 1, urls: [], paths: { tmp: '/tmp' } })
    )
    const gateway = new OpenCodeGateway({
      url: BASE_URL,
      username: 'clara',
      password: 'secret',
      fetch,
    })

    await gateway.probe()

    expect(requests[0]?.url.pathname).toBe('/api/info')
    expect(requests[0]?.headers.get('authorization')).toBe(
      `Basic ${Buffer.from('clara:secret').toString('base64')}`
    )
  })

  it('omits the auth header when no password is configured', async () => {
    const { fetch, requests } = createFakeFetch(() =>
      jsonResponse({ version: '2.1.1', pid: 1, urls: [], paths: { tmp: '/tmp' } })
    )
    const gateway = new OpenCodeGateway({ url: BASE_URL, fetch })

    await gateway.probe()

    expect(requests[0]?.headers.get('authorization')).toBeNull()
  })

  it('distinguishes rejected credentials, HTTP errors, and unreachable servers', async () => {
    const auth = new OpenCodeGateway({
      url: BASE_URL,
      password: 'wrong',
      fetch: createFakeFetch(() =>
        jsonResponse({ _tag: 'UnauthorizedError', message: 'unauthorized' }, 401)
      ).fetch,
    })
    expect(await auth.probe()).toMatchObject({ ok: false, code: 'auth', status: 401 })

    const http = new OpenCodeGateway({
      url: BASE_URL,
      fetch: createFakeFetch(() => jsonResponse({ message: 'broken' }, 503)).fetch,
    })
    expect(await http.probe()).toMatchObject({ ok: false, code: 'http', status: 503 })

    const unreachable = new OpenCodeGateway({
      url: BASE_URL,
      fetch: async () => {
        throw new TypeError('fetch failed')
      },
    })
    expect(await unreachable.probe()).toMatchObject({ ok: false, code: 'unreachable' })
  })

  it('reports a timeout when OpenCode does not answer', async () => {
    const gateway = new OpenCodeGateway({
      url: BASE_URL,
      fetch: (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => reject(init.signal?.reason ?? new Error('aborted')),
            { once: true }
          )
        }),
    })

    expect(await gateway.probe(5)).toMatchObject({ ok: false, code: 'timeout' })
  })
})

describe('OpenCodeGateway.reload', () => {
  it('posts to the location reload endpoint', async () => {
    const { fetch, requests } = createFakeFetch(() => new Response(null, { status: 204 }))
    const gateway = new OpenCodeGateway({ url: BASE_URL, fetch })

    await gateway.reload()

    expect(requests[0]?.method).toBe('POST')
    expect(requests[0]?.url.pathname).toBe('/api/location/reload')
  })

  it('reports a failed reload', async () => {
    const gateway = new OpenCodeGateway({
      url: BASE_URL,
      fetch: createFakeFetch(() =>
        jsonResponse({ _tag: 'ServiceUnavailableError', message: 'unavailable' }, 503)
      ).fetch,
    })

    await expect(gateway.reload()).rejects.toThrow('OpenCode reload failed (503)')
  })
})

describe('toAdapterError', () => {
  it('maps auth failures to harness_auth', async () => {
    const gateway = new OpenCodeGateway({
      url: BASE_URL,
      fetch: createFakeFetch(() =>
        jsonResponse({ _tag: 'UnauthorizedError', message: 'bad password' }, 401)
      ).fetch,
    })

    const error = await captureError(() => gateway.client.session.get({ sessionID: 's1' }))

    expect(error).toBeInstanceOf(AdapterError)
    expect(error).toMatchObject({
      status: 502,
      code: 'harness_auth',
      message: 'bad password',
    })
  })

  it('preserves a declared 404 and its upstream tag', async () => {
    const gateway = new OpenCodeGateway({
      url: BASE_URL,
      fetch: createFakeFetch(() =>
        jsonResponse(
          { _tag: 'SessionNotFoundError', sessionID: 'missing', message: 'Session not found' },
          404
        )
      ).fetch,
    })

    const error = await captureError(() => gateway.client.session.get({ sessionID: 'missing' }))

    expect(error).toMatchObject({
      status: 404,
      code: 'SessionNotFoundError',
      message: 'Session not found',
    })
  })

  it('maps 5xx responses to 502', async () => {
    const gateway = new OpenCodeGateway({
      url: BASE_URL,
      fetch: createFakeFetch(() => jsonResponse({ message: 'engine failed' }, 500)).fetch,
    })

    const error = await captureError(() => gateway.client.session.get({ sessionID: 's1' }))

    expect(error).toMatchObject({ status: 502, code: 'upstream_error' })
  })
})

describe('@opencode/client types', () => {
  it('exposes the pinned client surface', () => {
    expectTypeOf(OpenCode.make).toBeFunction()
    expectTypeOf<OpenCodeClient['session']['prompt']>().toBeFunction()
    expectTypeOf<OpenCodeClient['event']['subscribe']>().toBeFunction()
    expectTypeOf<OpenCodeClient['shell']['create']>().toBeFunction()
  })
})

async function captureError(operation: () => Promise<unknown>): Promise<AdapterError> {
  try {
    await operation()
  } catch (cause) {
    return toAdapterError(cause)
  }
  throw new Error('Expected the operation to fail')
}
