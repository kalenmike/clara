import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { createApiApp } from '../src/api/app.ts'
import type { ApiDependencies, LabEndpoint } from '../src/api/context.ts'

const servers: Server[] = []

afterEach(async () => {
  for (const server of servers.splice(0)) {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

type Seen = {
  path?: string
  authorization?: string
  origin?: string
  lab?: string
  body?: string
}

async function startLab(): Promise<{ endpoint: LabEndpoint; seen: Seen[] }> {
  const seen: Seen[] = []
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    seen.push({
      path: request.url,
      authorization: request.headers.authorization,
      origin: request.headers.origin,
      lab: request.headers['x-clara-lab'] as string | undefined,
      body: Buffer.concat(chunks).toString('utf8'),
    })
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({ ok: true, path: request.url }))
  })
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  return {
    endpoint: { url: `http://127.0.0.1:${port}`, token: 'lab-token' },
    seen,
  }
}

function createApi(lab?: () => LabEndpoint | undefined) {
  const deps = {
    harness: {},
    info: {},
    startedAt: Date.now(),
    canAccess: () => true,
    sessionCount: () => 0,
    ...(lab ? { lab } : {}),
    log: () => {},
  } as unknown as ApiDependencies
  return createApiApp(deps, { token: 'secret' })
}

function tunnel(path: string, init: RequestInit = {}): Request {
  return new Request(`http://clara.local/v1/lab${path}`, {
    ...init,
    headers: {
      'x-clara-agent': '1',
      ...((init.headers as Record<string, string> | undefined) ?? {}),
    },
  })
}

describe('lab tunnel bridge', () => {
  it('forwards the API path, bridge token, origin, and mutation header', async () => {
    const { endpoint, seen } = await startLab()
    const api = createApi(() => endpoint)

    const response = await api.fetch(
      tunnel('/preview', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-clara-lab': '1' },
        body: JSON.stringify({ workspace: '/workspace' }),
      })
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, path: '/api/preview' })
    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatchObject({
      path: '/api/preview',
      authorization: 'Bearer lab-token',
      origin: `http://127.0.0.1:${new URL(endpoint.url).port}`,
      lab: '1',
      body: JSON.stringify({ workspace: '/workspace' }),
    })
  })

  it('serves health through the bridge', async () => {
    const { endpoint } = await startLab()
    const api = createApi(() => endpoint)
    const response = await api.fetch(tunnel('/health'))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, path: '/api/health' })
  })

  it('reports a missing lab service as unavailable', async () => {
    const api = createApi()
    const response = await api.fetch(tunnel('/health'))
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ error: { code: 'lab_unavailable' } })
  })

  it('rejects traversal outside the lab API', async () => {
    const { endpoint } = await startLab()
    const api = createApi(() => endpoint)
    const response = await api.fetch(tunnel('/%2e%2e%2f%2e%2e%2fhealth'))
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: { code: 'invalid_path' } })
  })
})
