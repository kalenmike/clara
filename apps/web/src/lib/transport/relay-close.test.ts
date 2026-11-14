import { createServer, type Server } from 'node:http'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { generateKey, importSessionKey } from '@clara/crypto'
import { createRelayTransport, type RelayTransport } from './relay.ts'

let server: Server
let transport: RelayTransport | null = null

beforeEach(async () => {
  Object.defineProperty(globalThis, 'window', { configurable: true, value: globalThis })
})

afterEach(async () => {
  transport?.close()
  transport = null
  Object.defineProperty(globalThis, 'window', { configurable: true, value: undefined })
  Object.defineProperty(globalThis, 'location', { configurable: true, value: undefined })
  if (!server) return
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

describe('relay transport close reasons', () => {
  it('maps a relay 401 to a terminal re-pair state', async () => {
    // The Worker rejects an expired, revoked, or foreign grant with a plain
    // 401 before the upgrade. A browser cannot read that status, so a
    // reachable relay that still refuses must end the retry loop.
    let upgrades = 0
    server = createServer((request, response) => {
      if (request.url === '/health') {
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end('{"ok":true}')
        return
      }
      upgrades += 1
      response.writeHead(401, { 'content-type': 'application/json' })
      response.end('{"error":"unauthorized"}')
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('No test server address')

    transport = createRelayTransport({
      wsUrl: `ws://127.0.0.1:${address.port}/room/room-1`,
      grant: 'encoded.signature',
      credential: {
        kind: 'device',
        deviceId: 'device-test',
        key: await importSessionKey(generateKey()),
      },
    })

    await transport.connect().catch(() => {})
    await waitFor(() => transport?.status().state === 'closed')
    expect(transport.status().error).toMatch(/pair this device again/i)

    const attempts = upgrades
    await new Promise((resolve) => setTimeout(resolve, 1_500))
    expect(upgrades).toBe(attempts)
    await expect(
      transport.fetch('http://clara.relay/api/info', { signal: AbortSignal.timeout(3_000) })
    ).rejects.toThrow(/pair this device again/i)
  }, 10_000)

  it('reports a refused upgrade instead of a bare close', async () => {
    // An unreachable relay keeps the transient retry path. The socket closes
    // without a reason, so the user-facing error stays actionable.
    server = createServer((_request, response) => {
      response.writeHead(404, { 'content-type': 'application/json' })
      response.end('{"error":"not found"}')
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('No test server address')

    transport = createRelayTransport({
      wsUrl: `ws://127.0.0.1:${address.port}/ws`,
      grant: 'test-grant',
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
      'The relay refused the connection. Check the room URL and the relay configuration.'
    )
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
      grant: '',
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

async function waitFor(check: () => boolean, timeoutMs = 5_000): Promise<void> {
  const started = Date.now()
  while (!check()) {
    if (Date.now() - started > timeoutMs) throw new Error('Timed out waiting for the transport')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}
