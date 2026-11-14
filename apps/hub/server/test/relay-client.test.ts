import { createServer } from 'node:http'
import { WebSocketServer } from 'ws'
import { describe, expect, it } from 'vitest'
import type { Agent } from '../src/agent.ts'
import { RelayClient } from '../src/relay-client.ts'

const OUTDATED_RELAY = 'The relay is outdated; redeploy the Worker'

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

async function startRelay(options: { version?: string }): Promise<RelayServer> {
  const server = createServer()
  const sockets = new WebSocketServer({ server, handleProtocols: () => 'clara.v1' })
  if (options.version) {
    sockets.on('headers', (headers) => {
      headers.push(`x-clara-relay-version: ${options.version}`)
    })
  }
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
})
