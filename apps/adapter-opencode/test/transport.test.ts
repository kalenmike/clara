import { afterEach, describe, expect, it } from 'vitest'
import { WebSocketServer, type WebSocket } from 'ws'
import {
  bytesToBase64Url,
  deriveSessionKeys,
  generateKey,
  randomBytes,
  seal,
  utf8,
} from '@clara/crypto'
import { PROTOCOL_VERSION } from '@clara/shared-types'
import { AdapterTransport } from '../src/transport'

type Hello = {
  sid: string
  clientNonce: string
  agentNonce: string
}

type FakeHub = {
  wsUrl: string
  key: string
  hello: () => Promise<Hello>
  sendSealed: (hello: Hello, payload: unknown, signingKey?: string) => Promise<void>
  close: () => Promise<void>
}

const hubs: FakeHub[] = []

afterEach(async () => {
  await Promise.all(hubs.splice(0).map((hub) => hub.close()))
})

describe('AdapterTransport authentication', () => {
  it('reports authenticated only after opening the first sealed frame', async () => {
    const hub = await startHub()
    const logs: string[] = []
    const transport = createTransport(hub, logs)

    transport.start()
    const hello = await hub.hello()
    await waitFor(() => logs.includes('adapter handshake complete'))
    expect(logs).not.toContain('adapter authenticated')

    await hub.sendSealed(hello, { type: 'ready', agent: { version: 'test', protocol: 3 } })
    await waitFor(() => logs.includes('adapter authenticated'))
    transport.close()
  })

  it('does not report authenticated when the hub key does not match', async () => {
    const hub = await startHub()
    const logs: string[] = []
    const transport = createTransport(hub, logs)

    transport.start()
    const hello = await hub.hello()
    await waitFor(() => logs.includes('adapter handshake complete'))

    await hub.sendSealed(
      hello,
      { type: 'ready', agent: { version: 'test', protocol: 3 } },
      generateKey()
    )
    await waitFor(() => logs.includes('adapter could not open a frame'))
    expect(logs).not.toContain('adapter authenticated')
    transport.close()
  })
})

function createTransport(hub: FakeHub, logs: string[]): AdapterTransport {
  return new AdapterTransport({
    wsUrl: hub.wsUrl,
    clientToken: 'local',
    identity: { harnessId: 'harness', adapterId: 'adapter', key: hub.key },
    kind: 'opencode',
    label: 'OpenCode',
    info: { adapterVersion: 'test', protocolVersion: 1, capabilities: {} },
    handler: async () => new Response('{}', { status: 200 }),
    log: (message) => logs.push(message),
  })
}

async function startHub(): Promise<FakeHub> {
  const key = generateKey()
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 })
  await new Promise<void>((resolve) => server.once('listening', resolve))
  const address = server.address()
  if (typeof address === 'string' || !address) throw new Error('The test hub did not bind')

  let client: WebSocket | undefined
  let resolveHello!: (hello: Hello) => void
  const hello = new Promise<Hello>((resolve) => {
    resolveHello = resolve
  })

  server.on('connection', (socket) => {
    client = socket
    socket.on('message', (data) => {
      const frame = JSON.parse(data.toString()) as {
        t?: string
        sid?: string
        nonce?: string
      }
      if (frame.t !== 'hello' || !frame.sid || !frame.nonce) return
      const agentNonce = bytesToBase64Url(randomBytes(16))
      socket.send(
        JSON.stringify({
          t: 'hello',
          v: PROTOCOL_VERSION,
          sid: frame.sid,
          nonce: agentNonce,
          role: 'agent',
        })
      )
      resolveHello({ sid: frame.sid, clientNonce: frame.nonce, agentNonce })
    })
  })

  const hub: FakeHub = {
    wsUrl: `ws://127.0.0.1:${address.port}`,
    key,
    hello: () => hello,
    sendSealed: async (value, payload, signingKey = key) => {
      const keys = await deriveSessionKeys({
        key: signingKey,
        sid: value.sid,
        clientNonce: value.clientNonce,
        agentNonce: value.agentNonce,
      })
      const box = await seal(
        keys.s2c,
        { sid: value.sid, direction: 's2c', seq: 0 },
        utf8(JSON.stringify(payload))
      )
      client?.send(
        JSON.stringify({
          t: 'sealed',
          v: PROTOCOL_VERSION,
          sid: value.sid,
          seq: 0,
          iv: box.iv,
          ct: box.ct,
        })
      )
    },
    close: async () => {
      client?.terminate()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
  hubs.push(hub)
  return hub
}

async function waitFor(check: () => boolean, timeoutMs = 2_000): Promise<void> {
  const started = Date.now()
  while (!check()) {
    if (Date.now() - started > timeoutMs) throw new Error('Timed out waiting for adapter state')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}
