import { createServer, type Server } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import {
  bytesToBase64Url,
  deriveSessionKeys,
  generatePsk,
  open,
  randomBytes,
  seal,
  utf8,
  type SessionKeys,
} from '@clara/crypto'
import {
  PROTOCOL_VERSION,
  type ClaraAction,
  type ClaraState,
  type WireFrame,
} from '@clara/shared-types'
import { Agent } from '../src/agent.ts'
import { OpenCodeClient } from '../src/opencode.ts'
import type { PushService } from '../src/push/service.ts'

type FakeOpenCode = {
  url: string
  close: () => Promise<void>
}

async function startFakeOpenCode(): Promise<FakeOpenCode> {
  const server = createServer((request, response) => {
    if (request.url === '/api/info') {
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ version: '9.9.9', pid: 42, urls: [] }))
      return
    }
    if (request.url === '/api/stream') {
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.write('data: one\n\n')
      setTimeout(() => {
        response.write('data: two\n\n')
        response.end()
      }, 5)
      return
    }
    if (request.url === '/api/echo' && request.method === 'POST') {
      const chunks: Buffer[] = []
      request.on('data', (chunk: Buffer) => chunks.push(chunk))
      request.on('end', () => {
        response.setHeader('content-type', 'application/json')
        response.end(Buffer.concat(chunks))
      })
      return
    }
    response.statusCode = 404
    response.end('not found')
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No fake server address')
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => closeServer(server),
  }
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()))
}

type Client = {
  sid: string
  keys: SessionKeys
  sendSeq: number
  receiveSeq: number
}

const agents: Agent[] = []

async function connect(
  fake: FakeOpenCode,
  push?: PushService
): Promise<{
  agent: Agent
  client: Client
  frames: WireFrame[]
}> {
  const psk = generatePsk()
  const sid = 'test-session'
  const clientNonce = bytesToBase64Url(randomBytes(16))
  const frames: WireFrame[] = []
  const agent = new Agent({
    openCode: new OpenCodeClient(fake.url),
    psk,
    info: { version: 'test', protocol: PROTOCOL_VERSION },
    send: (frame) => frames.push(frame),
    push,
  })
  agents.push(agent)

  agent.handleMessage(
    JSON.stringify({ t: 'hello', v: PROTOCOL_VERSION, sid, nonce: clientNonce, role: 'client' })
  )

  const hello = await waitFor(() => frames.find((frame) => frame.t === 'hello'))
  if (hello.t !== 'hello') throw new Error('No hello frame')
  const keys = await deriveSessionKeys({
    psk,
    sid,
    clientNonce,
    agentNonce: hello.nonce,
  })
  const client: Client = { sid, keys, sendSeq: 0, receiveSeq: 0 }
  return { agent, client, frames }
}

async function send(client: Client, agent: Agent, payload: ClaraAction): Promise<void> {
  const seq = client.sendSeq
  client.sendSeq += 1
  const box = await seal(
    client.keys.c2s,
    { sid: client.sid, direction: 'c2s', seq },
    utf8(JSON.stringify(payload))
  )
  agent.handleMessage(
    JSON.stringify({
      t: 'sealed',
      v: PROTOCOL_VERSION,
      sid: client.sid,
      seq,
      iv: box.iv,
      ct: box.ct,
    })
  )
}

async function readStates(client: Client, frames: WireFrame[]): Promise<ClaraState[]> {
  const states: ClaraState[] = []
  for (const frame of frames) {
    if (frame.t !== 'sealed' || frame.sid !== client.sid) continue
    const plaintext = await open(
      client.keys.s2c,
      { sid: client.sid, direction: 's2c', seq: frame.seq },
      frame
    )
    const payload = JSON.parse(new TextDecoder().decode(plaintext)) as ClaraAction | ClaraState
    if (payload.type !== 'ready' && payload.type !== 'ready.ack' && payload.type !== 'pong') {
      states.push(payload as ClaraState)
    }
  }
  return states
}

async function waitFor<T>(
  read: () => T | undefined | Promise<T | undefined>,
  timeout = 2_000
): Promise<T> {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    const value = await read()
    if (value !== undefined) return value
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error('Timed out waiting for a frame')
}

afterEach(() => {
  for (const agent of agents.splice(0)) agent.close()
})

describe('agent', () => {
  it('proxies an API request over an encrypted session', async () => {
    const fake = await startFakeOpenCode()
    try {
      const { agent, client, frames } = await connect(fake)
      await waitFor(() => (frames.length >= 2 ? true : undefined))
      await send(client, agent, { type: 'ready.ack', agent: { version: 'web', protocol: 1 } })
      await send(client, agent, {
        type: 'http.request',
        id: 'request-1',
        method: 'GET',
        path: '/api/info',
      })

      const states = await waitFor(async () => {
        const parsed = await readStates(client, frames)
        return parsed.some((state) => state.type === 'http.end') ? parsed : undefined
      })

      expect(states.some((state) => state.type === 'http.response' && state.status === 200)).toBe(
        true
      )
      const chunks = states.filter((state) => state.type === 'http.chunk')
      const body = chunks
        .map((state) => (state.type === 'http.chunk' ? state.data : ''))
        .map((data) => Buffer.from(data, 'base64url').toString('utf8'))
        .join('')
      expect(JSON.parse(body)).toMatchObject({ version: '9.9.9' })
    } finally {
      await fake.close()
    }
  })

  it('streams a long-lived response', async () => {
    const fake = await startFakeOpenCode()
    try {
      const { agent, client, frames } = await connect(fake)
      await waitFor(() => (frames.length >= 2 ? true : undefined))
      await send(client, agent, { type: 'ready.ack', agent: { version: 'web', protocol: 1 } })
      await send(client, agent, {
        type: 'http.request',
        id: 'stream-1',
        method: 'GET',
        path: '/api/stream',
      })

      const states = await waitFor(async () => {
        const parsed = await readStates(client, frames)
        return parsed.some((state) => state.type === 'http.end') ? parsed : undefined
      })

      const body = states
        .filter((state) => state.type === 'http.chunk')
        .map((state) => (state.type === 'http.chunk' ? state.data : ''))
        .map((data) => Buffer.from(data, 'base64url').toString('utf8'))
        .join('')
      expect(body).toContain('data: one')
      expect(body).toContain('data: two')
    } finally {
      await fake.close()
    }
  })

  it('acknowledges a push subscription over the encrypted session', async () => {
    const fake = await startFakeOpenCode()
    try {
      const endpoint = 'https://web.push.apple.com/live-test'
      const push = {
        subscribe: () => ({ count: 1, endpoint }),
        unsubscribe: () => ({ count: 0, removed: true }),
        has: () => true,
        test: async () => ({ count: 1 }),
        count: 1,
      } as unknown as PushService
      const { agent, client, frames } = await connect(fake, push)
      await waitFor(() => (frames.length >= 2 ? true : undefined))
      await send(client, agent, { type: 'ready.ack', agent: { version: 'web', protocol: 1 } })
      await send(client, agent, {
        type: 'push.subscribe',
        id: 'push-1',
        subscription: {
          endpoint,
          expirationTime: null,
          keys: { p256dh: 'a'.repeat(87), auth: 'b'.repeat(22) },
        },
      })

      const states = await waitFor(async () => {
        const parsed = await readStates(client, frames)
        return parsed.some((state) => state.type === 'push.status') ? parsed : undefined
      })
      expect(states).toContainEqual({
        type: 'push.status',
        id: 'push-1',
        subscribed: true,
        endpoint,
        count: 1,
      })
    } finally {
      await fake.close()
    }
  })

  it('reports desk presence from heartbeat pings', async () => {
    const fake = await startFakeOpenCode()
    try {
      const { agent, client, frames } = await connect(fake)
      await waitFor(() => (frames.length >= 2 ? true : undefined))
      await send(client, agent, { type: 'ready.ack', agent: { version: 'web', protocol: 1 } })

      await send(client, agent, {
        type: 'ping',
        at: Date.now(),
        presence: { deviceClass: 'mobile', holdPhone: true, visible: true, idleMs: 0 },
      })
      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(agent.deskHoldActive()).toBe(false)

      await send(client, agent, {
        type: 'ping',
        at: Date.now(),
        presence: { deviceClass: 'desktop', holdPhone: true, visible: true, idleMs: 0 },
      })
      await waitFor(() => (agent.deskHoldActive() ? true : undefined))
      expect(agent.deskHoldActive(Date.now() + 120_000)).toBe(false)

      await send(client, agent, {
        type: 'ping',
        at: Date.now(),
        presence: { deviceClass: 'desktop', holdPhone: false, visible: true, idleMs: 600_000 },
      })
      await waitFor(() => (agent.deskHoldActive() ? undefined : true))
    } finally {
      await fake.close()
    }
  })

  it('rejects paths outside the OpenCode API', async () => {
    const fake = await startFakeOpenCode()
    try {
      const { agent, client, frames } = await connect(fake)
      await waitFor(() => (frames.length >= 2 ? true : undefined))
      await send(client, agent, { type: 'ready.ack', agent: { version: 'web', protocol: 1 } })
      await send(client, agent, {
        type: 'http.request',
        id: 'bad-1',
        method: 'GET',
        path: '/api/../secret',
      })

      const states = await waitFor(async () => {
        const parsed = await readStates(client, frames)
        return parsed.some((state) => state.type === 'http.error') ? parsed : undefined
      })
      expect(states.some((state) => state.type === 'http.error')).toBe(true)
    } finally {
      await fake.close()
    }
  })
})
