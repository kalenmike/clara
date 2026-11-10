import { createServer, type Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { WebSocketServer, type WebSocket } from 'ws'
import {
  bytesToBase64Url,
  deriveSessionKeys,
  generateKey,
  importSessionKey,
  open,
  randomBytes,
  seal,
  utf8,
  type SessionKeys,
} from '@clara/crypto'
import { PROTOCOL_VERSION, type ClaraAction, type ClaraState } from '@clara/shared-types'
import { createRelayTransport, MAX_IN_FLIGHT_REQUESTS, type RelayTransport } from './relay.ts'

let server: Server
let wss: WebSocketServer
let transport: RelayTransport
let deviceKey: string
let heldRequests: Array<{ release: () => void }> = []
let heldReceived = 0

function releaseHeld(): void {
  heldRequests.shift()?.release()
}

beforeAll(async () => {
  Object.defineProperty(globalThis, 'window', { configurable: true, value: globalThis })
  deviceKey = generateKey()

  server = createServer()
  wss = new WebSocketServer({
    server,
    handleProtocols: (protocols) => protocols.values().next().value ?? false,
  })
  wss.on('connection', (socket) => attachFakeAgent(socket, deviceKey))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No test server address')

  transport = createRelayTransport({
    wsUrl: `ws://127.0.0.1:${address.port}/ws`,
    clientToken: 'test-client',
    credential: {
      kind: 'device',
      deviceId: 'device-test',
      key: await importSessionKey(deviceKey),
    },
  })
})

afterAll(async () => {
  transport.close()
  await new Promise<void>((resolve) => wss.close(() => resolve()))
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

describe('relay fetch transport', () => {
  it('round-trips a JSON request through an encrypted session', async () => {
    const response = await transport.fetch('http://clara.relay/api/info', {
      signal: AbortSignal.timeout(3_000),
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, version: '9.9.9' })
  })

  it('streams server-sent events', async () => {
    const response = await transport.fetch('http://clara.relay/api/event', {
      signal: AbortSignal.timeout(3_000),
    })
    expect(response.headers.get('content-type')).toBe('text/event-stream')
    await expect(response.text()).resolves.toContain('data: hello')
  })

  it('queues requests above the in-flight cap', async () => {
    heldRequests = []
    heldReceived = 0
    const total = MAX_IN_FLIGHT_REQUESTS + 3
    const pending = Array.from({ length: total }, () =>
      transport.fetch('http://clara.relay/api/hold', { signal: AbortSignal.timeout(5_000) })
    )

    await waitFor(() => heldReceived === MAX_IN_FLIGHT_REQUESTS)
    expect(heldReceived).toBe(MAX_IN_FLIGHT_REQUESTS)

    for (let released = 0; released < total; released += 1) {
      await waitFor(() => heldRequests.length > 0)
      releaseHeld()
    }

    const responses = await Promise.all(pending)
    expect(responses.every((response) => response.status === 200)).toBe(true)
  })

  it('rejects a queued request when it aborts', async () => {
    heldRequests = []
    heldReceived = 0
    const held = Array.from({ length: MAX_IN_FLIGHT_REQUESTS }, () =>
      transport.fetch('http://clara.relay/api/hold', { signal: AbortSignal.timeout(5_000) })
    )
    await waitFor(() => heldReceived === MAX_IN_FLIGHT_REQUESTS)

    const controller = new AbortController()
    const queued = transport.fetch('http://clara.relay/api/hold', {
      signal: controller.signal,
    })
    controller.abort()

    await expect(queued).rejects.toMatchObject({ name: 'AbortError' })

    while (heldRequests.length > 0) releaseHeld()
    await Promise.all(held)
    expect(heldReceived).toBe(MAX_IN_FLIGHT_REQUESTS)
  })

  it('checks, pulls, and receives conflict snapshots', async () => {
    const check = await transport.requestSync({ type: 'sync.check', id: 'check-1' })
    expect(check).toEqual({ type: 'revision', namespace: 'default', revision: 1 })

    const pull = await transport.requestSync({ type: 'sync.pull', id: 'pull-1' })
    expect(pull).toMatchObject({
      type: 'snapshot',
      snapshot: {
        namespace: 'default',
        revision: 1,
        entries: [{ key: 'clara.colorTheme', value: 'nord' }],
      },
    })

    const conflict = await transport.requestSync({
      type: 'sync.push',
      id: 'push-1',
      entries: [{ key: 'clara.colorTheme', value: 'clara' }],
    })
    expect(conflict).toMatchObject({
      type: 'error',
      code: 'conflict',
      snapshot: { revision: 2 },
    })
  })

  it('updates the agent info from an agent.status frame', async () => {
    await transport.fetch('http://clara.relay/api/info', {
      signal: AbortSignal.timeout(3_000),
    })
    await waitFor(() => transport.status().agent?.syncIntervalMs === 15_000)
    expect(transport.status().agent).toMatchObject({
      version: 'status',
      syncEnabled: true,
      syncIntervalMs: 15_000,
    })
  })
})

async function waitFor(check: () => boolean, timeoutMs = 2_000): Promise<void> {
  const started = Date.now()
  while (!check()) {
    if (Date.now() - started > timeoutMs) throw new Error('Timed out waiting for the transport')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

function attachFakeAgent(socket: WebSocket, key: string): void {
  let keys: SessionKeys | null = null
  let sid = ''
  let sendSeq = 0
  let chain = Promise.resolve()

  const send = (payload: ClaraAction | ClaraState): void => {
    chain = chain.then(async () => {
      if (!keys) return
      const seq = sendSeq
      sendSeq += 1
      const box = await seal(
        keys.s2c,
        { sid, direction: 's2c', seq },
        utf8(JSON.stringify(payload))
      )
      socket.send(
        JSON.stringify({
          t: 'sealed',
          v: PROTOCOL_VERSION,
          sid,
          seq,
          iv: box.iv,
          ct: box.ct,
        })
      )
    })
  }

  socket.on('message', (data) => {
    void handle(data.toString())
  })

  async function handle(text: string): Promise<void> {
    const frame = JSON.parse(text) as Record<string, unknown>
    if (frame.t === 'hello') {
      sid = String(frame.sid)
      const agentNonce = bytesToBase64Url(randomBytes(16))
      keys = await deriveSessionKeys({
        key,
        sid,
        clientNonce: String(frame.nonce),
        agentNonce,
      })
      socket.send(
        JSON.stringify({
          t: 'hello',
          v: PROTOCOL_VERSION,
          sid,
          nonce: agentNonce,
          role: 'agent',
        })
      )
      send({ type: 'ready', agent: { version: 'test', protocol: PROTOCOL_VERSION } })
      send({
        type: 'agent.status',
        online: true,
        agent: {
          version: 'status',
          protocol: PROTOCOL_VERSION,
          syncEnabled: true,
          syncIntervalMs: 15_000,
        },
      })
      return
    }

    if (frame.t !== 'sealed' || !keys) return
    const plaintext = await open(
      keys.c2s,
      { sid, direction: 'c2s', seq: Number(frame.seq) },
      { iv: String(frame.iv), ct: String(frame.ct) }
    )
    const payload = JSON.parse(new TextDecoder().decode(plaintext)) as ClaraAction

    if (payload.type === 'ready.ack') return

    if (payload.type === 'sync.check') {
      send({ type: 'sync.revision', id: payload.id, namespace: 'default', revision: 1 })
      return
    }
    if (payload.type === 'sync.pull') {
      send({
        type: 'sync.snapshot',
        id: payload.id,
        namespace: 'default',
        revision: 1,
        entries: [{ key: 'clara.colorTheme', value: 'nord', updatedAt: 1 }],
      })
      return
    }
    if (payload.type === 'sync.push') {
      send({
        type: 'sync.error',
        id: payload.id,
        namespace: 'default',
        code: 'conflict',
        message: 'The namespace is at revision 2',
        revision: 2,
        entries: [{ key: 'clara.colorTheme', value: 'nord', updatedAt: 1 }],
      })
      return
    }

    if (payload.type !== 'http.request') return

    if (payload.path === '/api/hold') {
      heldReceived += 1
      await new Promise<void>((resolve) => {
        heldRequests.push({
          release: () => {
            resolve()
            send({
              type: 'http.response',
              id: payload.id,
              status: 200,
              statusText: 'OK',
              headers: { 'content-type': 'application/json' },
            })
            send({
              type: 'http.chunk',
              id: payload.id,
              data: bytesToBase64Url(utf8('{}')),
            })
            send({ type: 'http.end', id: payload.id })
          },
        })
      })
      return
    }

    if (payload.path === '/api/event') {
      send({
        type: 'http.response',
        id: payload.id,
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'text/event-stream' },
      })
      send({
        type: 'http.chunk',
        id: payload.id,
        data: bytesToBase64Url(utf8('data: hello\n\n')),
      })
      send({ type: 'http.end', id: payload.id })
      return
    }

    send({
      type: 'http.response',
      id: payload.id,
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'application/json' },
    })
    send({
      type: 'http.chunk',
      id: payload.id,
      data: bytesToBase64Url(utf8(JSON.stringify({ ok: true, version: '9.9.9' }))),
    })
    send({ type: 'http.end', id: payload.id })
  }
}
