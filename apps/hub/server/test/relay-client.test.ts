import { createServer } from 'node:http'
import { WebSocketServer } from 'ws'
import { describe, expect, it, vi } from 'vitest'
import type { Agent } from '../src/agent.ts'
import { RelayClient } from '../src/relay-client.ts'

const OUTDATED_RELAY = 'The relay is outdated; redeploy the Worker'
const REPLACED =
  'Another hub connected to this room. Check for a second hub using the same token, or rotate the hub token.'

function fakeAgent(): {
  agent: Agent
  modes: string[]
  issuers: Array<{ room: string; agentToken: string } | undefined>
} {
  const modes: string[] = []
  const issuers: Array<{ room: string; agentToken: string } | undefined> = []
  const agent = {
    setEnvelope: (mode: string) => modes.push(mode),
    setGrantIssuer: (issuer: { room: string; agentToken: string } | undefined) =>
      issuers.push(issuer),
    reset: () => {},
    handleMessage: () => {},
  } as unknown as Agent
  return { agent, modes, issuers }
}

type RelayServer = {
  url: string
  close: () => Promise<void>
}

async function startRelay(
  options: { version?: string; closeCode?: number; terminate?: boolean } = {}
): Promise<RelayServer> {
  const server = createServer()
  const sockets = new WebSocketServer({ server, handleProtocols: () => 'clara.v1' })
  if (options.version) {
    sockets.on('headers', (headers) => {
      headers.push(`x-clara-relay-version: ${options.version}`)
    })
  }
  sockets.on('connection', (socket) => {
    if (options.terminate) socket.terminate()
    else if (options.closeCode !== undefined) socket.close(options.closeCode, 'test close')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No relay address')
  return {
    url: `ws://127.0.0.1:${address.port}`,
    close: async () => {
      for (const socket of sockets.clients) socket.terminate()
      await new Promise<void>((resolve) => sockets.close(() => resolve()))
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}

async function waitFor<T>(read: () => T | undefined, timeout = 2_000): Promise<T> {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    const value = read()
    if (value !== undefined) return value
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error('Timed out waiting for the relay client')
}

describe('relay client', () => {
  it('sets the relay envelope and grant issuer on its agent', () => {
    const { agent, modes, issuers } = fakeAgent()
    const client = new RelayClient({
      url: 'ws://127.0.0.1:1',
      room: 'room',
      agentToken: 'token',
      agent,
    })
    try {
      expect(modes).toEqual(['relay'])
      expect(issuers).toEqual([{ room: 'room', agentToken: 'token' }])
    } finally {
      client.close()
    }
  })

  it('connects to a version 3 relay', async () => {
    const relay = await startRelay({ version: '3' })
    const { agent } = fakeAgent()
    const client = new RelayClient({
      url: relay.url,
      room: 'room',
      agentToken: 'token',
      agent,
    })
    try {
      client.start()
      await waitFor(() => (client.getSnapshot().status === 'online' ? true : undefined))
      expect(client.getSnapshot().lastError).toBeUndefined()
    } finally {
      client.close()
      await relay.close()
    }
  })

  it('closes and reports a relay with an outdated routing version', async () => {
    for (const version of [undefined, '1', '2']) {
      const relay = await startRelay(version ? { version } : {})
      const { agent } = fakeAgent()
      const client = new RelayClient({
        url: relay.url,
        room: 'room',
        agentToken: 'token',
        agent,
      })
      try {
        client.start()
        await waitFor(() => client.getSnapshot().lastError)
        expect(client.getSnapshot().lastError).toBe(OUTDATED_RELAY)
        expect(client.getSnapshot().status).not.toBe('online')
      } finally {
        client.close()
        await relay.close()
      }
    }
  })

  it('reports a replacement and waits at least 30 seconds before reconnecting', async () => {
    const relay = await startRelay({ version: '3', closeCode: 4002 })
    const { agent } = fakeAgent()
    const client = new RelayClient({
      url: relay.url,
      room: 'room',
      agentToken: 'token',
      agent,
    })
    const schedule = vi.spyOn(
      client as unknown as { scheduleReconnect: (minimumDelay?: number) => void },
      'scheduleReconnect'
    )
    try {
      client.start()
      await waitFor(() => client.getSnapshot().replacedAt)
      const snapshot = client.getSnapshot()
      expect(snapshot.replacedAt).toBeGreaterThan(0)
      expect(snapshot.lastError).toBe(REPLACED)
      expect(snapshot.status).toBe('reconnecting')
      expect(snapshot).not.toHaveProperty('connectedSince')
      expect(schedule).toHaveBeenCalled()
      expect(schedule.mock.calls[0]?.[0] ?? 0).toBeGreaterThanOrEqual(30_000)
    } finally {
      schedule.mockRestore()
      client.close()
      await relay.close()
    }
  })

  it('keeps the short backoff for an ordinary relay close', async () => {
    for (const close of [{ closeCode: 1012 }, { terminate: true }]) {
      const relay = await startRelay({ version: '3', ...close })
      const { agent } = fakeAgent()
      const client = new RelayClient({
        url: relay.url,
        room: 'room',
        agentToken: 'token',
        agent,
      })
      const schedule = vi.spyOn(
        client as unknown as { scheduleReconnect: (minimumDelay?: number) => void },
        'scheduleReconnect'
      )
      try {
        client.start()
        await waitFor(() => (client.getSnapshot().reconnectAttempts > 0 ? true : undefined))
        const snapshot = client.getSnapshot()
        expect(snapshot).not.toHaveProperty('replacedAt')
        expect(snapshot).not.toHaveProperty('lastError')
        expect(snapshot.status).toBe('reconnecting')
        expect(schedule).toHaveBeenCalled()
        expect(schedule.mock.calls[0]?.[0] ?? 0).toBe(0)
      } finally {
        schedule.mockRestore()
        client.close()
        await relay.close()
      }
    }
  })
})
