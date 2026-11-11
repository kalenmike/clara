import { createServer, type Server } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { OpenCodeClient } from '../src/opencode.ts'

const servers: Server[] = []

async function listen(server: Server): Promise<number> {
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No fake server address')
  return address.port
}

async function close(server: Server): Promise<void> {
  const index = servers.indexOf(server)
  if (index !== -1) servers.splice(index, 1)
  await new Promise<void>((resolve) => server.close(() => resolve()))
}

afterEach(async () => {
  for (const server of servers.splice(0)) {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

describe('OpenCodeClient.probe', () => {
  it('reports the server version and latency', async () => {
    const server = createServer((_request, response) => {
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ version: '2.1.1' }))
    })
    const port = await listen(server)

    const probe = await new OpenCodeClient(`http://127.0.0.1:${port}`).probe()

    expect(probe.ok).toBe(true)
    expect(probe.code).toBe('ok')
    expect(probe.version).toBe('2.1.1')
    expect(probe.latencyMs).toBeGreaterThanOrEqual(0)
  })

  it('distinguishes a rejected password from an unreachable server', async () => {
    const authServer = createServer((_request, response) => {
      response.statusCode = 401
      response.end('unauthorized')
    })
    const port = await listen(authServer)

    const auth = await new OpenCodeClient(`http://127.0.0.1:${port}`, 'wrong').probe()
    expect(auth.ok).toBe(false)
    expect(auth.code).toBe('auth')
    expect(auth.status).toBe(401)

    await close(authServer)
    const unreachable = await new OpenCodeClient(`http://127.0.0.1:${port}`).probe(500)
    expect(unreachable.ok).toBe(false)
    expect(unreachable.code).toBe('unreachable')
  })
})

describe('OpenCodeClient.reload', () => {
  it('posts to the location reload endpoint', async () => {
    const requests: string[] = []
    const server = createServer((request, response) => {
      requests.push(`${request.method} ${request.url}`)
      response.statusCode = 204
      response.end()
    })
    const port = await listen(server)

    await new OpenCodeClient(`http://127.0.0.1:${port}`).reload()

    expect(requests).toEqual(['POST /api/location/reload'])
  })

  it('reports a failed reload', async () => {
    const server = createServer((_request, response) => {
      response.statusCode = 503
      response.end()
    })
    const port = await listen(server)

    await expect(new OpenCodeClient(`http://127.0.0.1:${port}`).reload()).rejects.toThrow(
      'OpenCode reload failed (503)'
    )
  })
})
