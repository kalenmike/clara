import { createServer, type Server } from 'node:http'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { generateKey } from '@clara/crypto'
import { createRelayTransport, type RelayTransport } from './relay.ts'

let server: Server
let transport: RelayTransport | null = null

beforeEach(async () => {
  Object.defineProperty(globalThis, 'window', { configurable: true, value: globalThis })
})

afterEach(async () => {
  transport?.close()
  transport = null
  Object.defineProperty(globalThis, 'location', { configurable: true, value: undefined })
  if (!server) return
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

describe('relay transport close reasons', () => {
  it('reports a refused upgrade instead of a bare close', async () => {
    // A Worker 404/401 rejects the upgrade, which closes the socket without a
    // reason. Keep the user-facing error actionable.
    server = createServer((_request, response) => {
      response.writeHead(404, { 'content-type': 'application/json' })
      response.end('{"error":"not found"}')
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('No test server address')

    transport = createRelayTransport({
      wsUrl: `ws://127.0.0.1:${address.port}/ws`,
      clientToken: 'test-client',
      credential: {
        kind: 'enroll',
        enrollId: 'unused',
        enrollToken: generateKey(),
        expiresAt: Date.now() + 60_000,
      },
    })

    await expect(
      transport.fetch('http://clara.relay/api/info', { signal: AbortSignal.timeout(3_000) })
    ).rejects.toThrow('The relay refused the connection. Check the room URL and the client token.')
  })

  it('explains a local-only pairing blocked on an HTTPS page', async () => {
    Object.defineProperty(globalThis, 'location', {
      configurable: true,
      value: { protocol: 'https:' },
    })
    server = createServer((_request, response) => {
      response.writeHead(404)
      response.end()
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('No test server address')

    transport = createRelayTransport({
      wsUrl: `ws://127.0.0.1:${address.port}/ws`,
      clientToken: 'local',
      credential: {
        kind: 'enroll',
        enrollId: 'unused',
        enrollToken: generateKey(),
        expiresAt: Date.now() + 60_000,
      },
    })

    await expect(
      transport.fetch('http://clara.relay/api/info', { signal: AbortSignal.timeout(3_000) })
    ).rejects.toThrow(
      'This pairing code is local-only. Configure the relay on the hub, then pair again.'
    )
  })
})
