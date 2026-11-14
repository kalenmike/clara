import { afterEach, describe, expect, it } from 'vitest'
import { WebSocket, WebSocketServer } from 'ws'
import {
  bytesToBase64Url,
  deriveSessionKeys,
  generateKey,
  open,
  randomBytes,
  seal,
  utf8,
  type SessionKeys,
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
  sendSealed: (
    hello: Hello,
    payload: unknown,
    options?: { signingKey?: string; seq?: number }
  ) => Promise<void>
  sendError: (sid: string, message?: string) => void
  sendForeignSealed: (sid: string) => void
  isOpen: () => boolean
  arrivalSeqs: () => number[]
  clientFrames: () => Array<{ seq: number; payload: Record<string, unknown> }>
  waitForClient: (
    check: (frames: Array<{ seq: number; payload: Record<string, unknown> }>) => boolean,
    timeoutMs?: number
  ) => Promise<Array<{ seq: number; payload: Record<string, unknown> }>>
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
      {
        signingKey: generateKey(),
      }
    )
    await waitFor(() => logs.includes('adapter could not open a frame'))
    expect(logs).not.toContain('adapter authenticated')
    transport.close()
  })

  it('ignores sealed frames for another session', async () => {
    const hub = await startHub()
    const logs: string[] = []
    const transport = createTransport(hub, logs)

    transport.start()
    const hello = await hub.hello()
    await waitFor(() => logs.includes('adapter handshake complete'))

    hub.sendForeignSealed('another-session')
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(logs).not.toContain('adapter could not open a frame')
    expect(hub.isOpen()).toBe(true)

    await hub.sendSealed(hello, { type: 'ready', agent: { version: 'test', protocol: 3 } })
    await waitFor(() => logs.includes('adapter authenticated'))
    expect(logs).not.toContain('adapter could not open a frame')
    transport.close()
  })

  it('ignores error frames for another session', async () => {
    const hub = await startHub()
    const logs: string[] = []
    const transport = createTransport(hub, logs)

    transport.start()
    const hello = await hub.hello()
    await waitFor(() => logs.includes('adapter handshake complete'))

    hub.sendError('another-session')
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(hub.isOpen()).toBe(true)
    expect(logs.some((line) => line.startsWith('adapter session error'))).toBe(false)

    await hub.sendSealed(hello, { type: 'ready', agent: { version: 'test', protocol: 3 } })
    await waitFor(() => logs.includes('adapter authenticated'))
    transport.close()
  })

  it('aborts an inbound request when the hub cancels it', async () => {
    const hub = await startHub()
    const logs: string[] = []
    let started!: () => void
    const requestStarted = new Promise<void>((resolve) => {
      started = resolve
    })
    let aborted = false
    // Keep the Request alive while the handler waits. The abort link lives on
    // the Request, not only on its signal, so collecting it under GC pressure
    // can stop the controller's abort from reaching this listener.
    let heldRequest: Request | undefined
    const transport = createTransport(hub, logs, async (request) => {
      heldRequest = request
      await new Promise<void>((resolve) => {
        const onAbort = () => {
          aborted = true
          resolve()
        }
        // Register before announcing the request so an abort cannot slip
        // between the start signal and the listener.
        request.signal.addEventListener('abort', onAbort, { once: true })
        started()
        if (request.signal.aborted) onAbort()
      })
      return new Response('late', { status: 200 })
    })

    transport.start()
    const hello = await hub.hello()
    await hub.sendSealed(hello, { type: 'ready', agent: { version: 'test', protocol: 3 } })
    await waitFor(() => logs.includes('adapter authenticated'))

    await hub.sendSealed(
      hello,
      { type: 'adapter.request', id: 'request-1', method: 'GET', path: '/slow' },
      { seq: 1 }
    )
    await requestStarted
    await hub.sendSealed(hello, { type: 'adapter.abort', id: 'request-1' }, { seq: 2 })
    await waitFor(() => aborted, 90_000)
    expect(heldRequest).toBeDefined()
    transport.close()
  }, 120_000)
})

describe('AdapterTransport send ordering', () => {
  it('keeps concurrent responses in sealed sequence order', async () => {
    const hub = await startHub()
    const logs: string[] = []
    const transport = createTransport(hub, logs, async (request) => {
      const path = new URL(request.url).pathname
      if (path === '/large') {
        await new Promise((resolve) => setTimeout(resolve, 5))
        return new Response('x'.repeat(200_000), { status: 200 })
      }
      return new Response('{}', { status: 200 })
    })

    transport.start()
    const hello = await hub.hello()
    await hub.sendSealed(hello, { type: 'ready', agent: { version: 'test', protocol: 3 } })
    await waitFor(() => logs.includes('adapter authenticated'))

    await hub.sendSealed(
      hello,
      { type: 'adapter.request', id: 'large', method: 'GET', path: '/large' },
      { seq: 1 }
    )
    await hub.sendSealed(
      hello,
      { type: 'adapter.request', id: 'small', method: 'GET', path: '/small' },
      { seq: 2 }
    )

    const frames = await hub.waitForClient(
      (value) => value.filter((frame) => frame.payload.type === 'adapter.end').length === 2,
      10_000
    )
    const arrival = hub.arrivalSeqs()
    expect(arrival).toEqual(arrival.map((_, index) => index))

    const ordered = frames.slice().sort((left, right) => left.seq - right.seq)
    for (const id of ['large', 'small']) {
      const response = ordered.findIndex(
        (frame) => frame.payload.type === 'adapter.response' && frame.payload.id === id
      )
      const end = ordered.findIndex(
        (frame) => frame.payload.type === 'adapter.end' && frame.payload.id === id
      )
      expect(response).toBeGreaterThanOrEqual(0)
      expect(end).toBeGreaterThan(response)
    }
    transport.close()
  }, 15_000)
})

function createTransport(
  hub: FakeHub,
  logs: string[],
  handler: (request: Request) => Promise<Response> = async () => new Response('{}', { status: 200 })
): AdapterTransport {
  return new AdapterTransport({
    wsUrl: hub.wsUrl,
    grant: 'test-grant',
    identity: { harnessId: 'harness', adapterId: 'adapter', key: hub.key },
    kind: 'opencode',
    label: 'OpenCode',
    info: { adapterVersion: 'test', protocolVersion: 1, capabilities: {} },
    handler,
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
  let keys: SessionKeys | undefined
  const clientFrames: Array<{ seq: number; payload: Record<string, unknown> }> = []
  const arrival: number[] = []
  let resolveHello!: (hello: Hello) => void
  const hello = new Promise<Hello>((resolve) => {
    resolveHello = resolve
  })

  server.on('connection', (socket) => {
    client = socket
    socket.on('message', (data) => {
      void handleFrame(data.toString())
    })

    async function handleFrame(text: string): Promise<void> {
      const frame = JSON.parse(text) as {
        t?: string
        sid?: string
        nonce?: string
        seq?: number
        iv?: string
        ct?: string
      }
      if (frame.t === 'hello' && frame.sid && frame.nonce) {
        const agentNonce = bytesToBase64Url(randomBytes(16))
        keys = await deriveSessionKeys({
          key,
          sid: frame.sid,
          clientNonce: frame.nonce,
          agentNonce,
        })
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
        return
      }
      if (
        frame.t !== 'sealed' ||
        frame.sid === undefined ||
        frame.seq === undefined ||
        frame.iv === undefined ||
        frame.ct === undefined ||
        !keys ||
        !frame.sid
      ) {
        return
      }
      arrival.push(frame.seq)
      const plaintext = await open(
        keys.c2s,
        { sid: frame.sid, direction: 'c2s', seq: frame.seq },
        { iv: frame.iv, ct: frame.ct }
      )
      clientFrames.push({
        seq: frame.seq,
        payload: JSON.parse(new TextDecoder().decode(plaintext)) as Record<string, unknown>,
      })
    }
  })

  const hub: FakeHub = {
    wsUrl: `ws://127.0.0.1:${address.port}`,
    key,
    hello: () => hello,
    sendSealed: async (value, payload, options = {}) => {
      const seq = options.seq ?? 0
      const keys = await deriveSessionKeys({
        key: options.signingKey ?? key,
        sid: value.sid,
        clientNonce: value.clientNonce,
        agentNonce: value.agentNonce,
      })
      const box = await seal(
        keys.s2c,
        { sid: value.sid, direction: 's2c', seq },
        utf8(JSON.stringify(payload))
      )
      client?.send(
        JSON.stringify({
          t: 'sealed',
          v: PROTOCOL_VERSION,
          sid: value.sid,
          seq,
          iv: box.iv,
          ct: box.ct,
        })
      )
    },
    sendError: (sid, message = 'not allowed') => {
      client?.send(
        JSON.stringify({
          t: 'error',
          v: PROTOCOL_VERSION,
          sid,
          code: 'invalid_device',
          message,
        })
      )
    },
    sendForeignSealed: (sid) => {
      client?.send(
        JSON.stringify({
          t: 'sealed',
          v: PROTOCOL_VERSION,
          sid,
          seq: 0,
          iv: 'foreign-iv',
          ct: 'foreign-ct',
        })
      )
    },
    isOpen: () => client?.readyState === WebSocket.OPEN,
    arrivalSeqs: () => arrival.slice(),
    clientFrames: () => clientFrames.slice(),
    waitForClient: async (check, timeoutMs = 2_000) => {
      const started = Date.now()
      while (!check(clientFrames)) {
        if (Date.now() - started > timeoutMs) {
          throw new Error('Timed out waiting for adapter frames')
        }
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
      return clientFrames.slice()
    },
    close: async () => {
      client?.terminate()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
  hubs.push(hub)
  return hub
}

async function waitFor(check: () => boolean, timeoutMs = 10_000): Promise<void> {
  const started = Date.now()
  while (!check()) {
    if (Date.now() - started > timeoutMs) throw new Error('Timed out waiting for adapter state')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}
