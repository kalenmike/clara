import { afterEach, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import { WebSocket, WebSocketServer } from 'ws'
import {
  base64UrlToBytes,
  bytesToBase64Url,
  deriveV4SessionKeys,
  generateEphemeralKeyPair,
  generateKey,
  open,
  randomBytes,
  seal,
  utf8,
  type V4SessionKeys,
  type V4EphemeralKeyPair,
} from '@clara/crypto'
import {
  PROTOCOL_VERSION,
  RELAY_AUTH_PREFIX,
  type AdapterHostIdentity,
  type AgentInfo,
  type RelayGrantState,
} from '@clara/shared-types'
import { REINSTALL_GRANT_MESSAGE } from '../src/config'
import { AdapterTransport } from '../src/transport'

type Hello = {
  sid: string
  clientNonce: string
  agentNonce: string
  clientEph: string
  ephemeral: V4EphemeralKeyPair
  keys: V4SessionKeys
}

type ClientFrame = { seq: number; payload: Record<string, unknown> }

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
  dropClient: () => void
  closeClient: (code: number, reason: string) => void
  isOpen: () => boolean
  protocols: () => Array<string | undefined>
  connectionCount: () => number
  arrivalSeqs: () => number[]
  clientFrames: () => ClientFrame[]
  waitForClient: (
    check: (frames: ClientFrame[]) => boolean,
    timeoutMs?: number
  ) => Promise<ClientFrame[]>
  close: () => Promise<void>
}

const hubs: FakeHub[] = []
const rejections: Array<{ close: () => Promise<void>; upgrades: () => number }> = []

afterEach(async () => {
  await Promise.all(hubs.splice(0).map((hub) => hub.close()))
  await Promise.all(rejections.splice(0).map((hub) => hub.close()))
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

    await hub.sendSealed(hello, { type: 'ready', agent: { version: 'test', protocol: 4 } })
    await waitFor(() => logs.includes('adapter authenticated'))
    transport.close()
  })

  it('reports its host on ready.ack', async () => {
    const hub = await startHub()
    const logs: string[] = []
    const host = { hostname: 'build-box', platform: 'linux', arch: 'x64' }
    const transport = createTransport(hub, logs, undefined, { host })

    transport.start()
    const hello = await hub.hello()
    await waitFor(() => logs.includes('adapter handshake complete'))
    await hub.sendSealed(hello, { type: 'ready', agent: { version: 'test', protocol: 4 } })

    const frames = await hub.waitForClient((value) =>
      value.some((frame) => frame.payload.type === 'ready.ack')
    )
    const ack = frames.find((frame) => frame.payload.type === 'ready.ack')
    expect(ack?.payload.host).toEqual(host)
    transport.close()
  })

  it('keeps the controller endpoints from ready and agent.status', async () => {
    const hub = await startHub()
    const logs: string[] = []
    const infos: AgentInfo[] = []
    const transport = createTransport(hub, logs, undefined, {
      onHubInfo: (info) => infos.push(info),
    })

    transport.start()
    const hello = await hub.hello()
    await waitFor(() => logs.includes('adapter handshake complete'))

    await hub.sendSealed(hello, {
      type: 'ready',
      agent: {
        version: 'test',
        protocol: 4,
        endpoints: { web: 'https://clara.example.com' },
      },
    })
    await waitFor(() => (infos.length > 0 ? infos[0] : undefined))
    expect(infos[0]?.endpoints?.web).toBe('https://clara.example.com')

    await hub.sendSealed(
      hello,
      {
        type: 'agent.status',
        online: true,
        agent: {
          version: 'test',
          protocol: 4,
          endpoints: { web: 'https://clara.example.org' },
        },
      },
      { seq: 1 }
    )
    await waitFor(() => (infos.length > 1 ? infos[1] : undefined))
    expect(infos[1]?.endpoints?.web).toBe('https://clara.example.org')
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
      { type: 'ready', agent: { version: 'test', protocol: 4 } },
      { signingKey: generateKey() }
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

    await hub.sendSealed(hello, { type: 'ready', agent: { version: 'test', protocol: 4 } })
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

    await hub.sendSealed(hello, { type: 'ready', agent: { version: 'test', protocol: 4 } })
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
    await hub.sendSealed(hello, { type: 'ready', agent: { version: 'test', protocol: 4 } })
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

describe('AdapterTransport grants', () => {
  it('presents the grant and keeps the bare socket in local mode', async () => {
    const hub = await startHub()
    const logs: string[] = []
    const relay = createTransport(hub, logs, undefined, { grant: 'grant-one' })
    const local = createTransport(hub, logs)

    relay.start()
    await hub.hello()
    await waitFor(() => hub.protocols().length === 1)
    expect(hub.protocols()[0]).toContain(`${RELAY_AUTH_PREFIX}grant-one`)
    relay.close()

    local.start()
    await waitFor(() => hub.protocols().length === 2)
    expect(hub.protocols()[1]).toBeUndefined()
    local.close()
  })

  it('persists a refreshed grant from ready and reconnects with it', async () => {
    const hub = await startHub()
    const logs: string[] = []
    const refreshed: RelayGrantState[] = []
    const transport = createTransport(hub, logs, undefined, {
      grant: 'grant-one',
      onRelayGrant: (grant) => refreshed.push(grant),
    })

    transport.start()
    const hello = await hub.hello()
    const relayGrant = { grant: 'grant-two', expiresAt: Date.now() + 60_000 }
    await hub.sendSealed(hello, {
      type: 'ready',
      agent: { version: 'test', protocol: 4 },
      relayGrant,
    })
    await waitFor(() => logs.includes('adapter authenticated'))
    await waitFor(() => refreshed.length === 1)
    expect(refreshed[0]).toEqual(relayGrant)

    hub.dropClient()
    await waitFor(() => hub.connectionCount() === 2, 6_000)
    await waitFor(() => hub.protocols().length === 2, 6_000)
    expect(hub.protocols()[1]).toContain(`${RELAY_AUTH_PREFIX}grant-two`)
    transport.close()
  }, 15_000)

  it('stops with the reinstall message when the relay refuses the grant', async () => {
    const hub = await startRejectingHub(401)
    const logs: string[] = []
    const transport = createTransport({ wsUrl: hub.wsUrl, key: generateKey() }, logs, undefined, {
      grant: 'expired-grant',
    })

    transport.start()
    await waitFor(() => logs.includes(REINSTALL_GRANT_MESSAGE))
    await waitFor(() => transport.status.status === 'stopped')
    expect(transport.status.lastError).toBe(REINSTALL_GRANT_MESSAGE)
    // A rejected grant is fatal: the adapter must not retry the same config.
    await new Promise((resolve) => setTimeout(resolve, 1_200))
    expect(hub.upgrades()).toBe(1)
    transport.close()
  }, 15_000)

  it('rejects a hub hello whose MAC does not verify', async () => {
    const hub = await startHub({ corruptMac: true })
    const logs: string[] = []
    const transport = createTransport(hub, logs)

    transport.start()
    await waitFor(() => logs.some((line) => line.includes('MAC did not verify')))
    expect(transport.status.authenticated).toBe(false)
    expect(transport.status.lastError).toContain('MAC did not verify')
    // A failed handshake is transient, so the adapter backs off and retries.
    await waitFor(() => hub.connectionCount() >= 2, 6_000)
    transport.close()
  }, 15_000)
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
    await hub.sendSealed(hello, { type: 'ready', agent: { version: 'test', protocol: 4 } })
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

describe('AdapterTransport chunking and disconnect diagnostics', () => {
  it('splits a large response into frames under the relay cap', async () => {
    const body = 'x'.repeat(200_000)
    const hub = await startHub()
    const logs: string[] = []
    const transport = createTransport(hub, logs, async () => new Response(body, { status: 200 }))

    transport.start()
    const hello = await hub.hello()
    await hub.sendSealed(hello, { type: 'ready', agent: { version: 'test', protocol: 4 } })
    await waitFor(() => logs.includes('adapter authenticated'))

    await hub.sendSealed(
      hello,
      { type: 'adapter.request', id: 'large', method: 'GET', path: '/large' },
      { seq: 1 }
    )

    const frames = await hub.waitForClient(
      (value) => value.filter((frame) => frame.payload.type === 'adapter.end').length === 1,
      10_000
    )
    const chunks = frames.filter((frame) => frame.payload.type === 'adapter.chunk')
    expect(chunks.length).toBeGreaterThan(1)

    const received: Uint8Array[] = []
    for (const chunk of chunks) {
      const bytes = base64UrlToBytes(String(chunk.payload.data))
      expect(bytes.byteLength).toBeLessThanOrEqual(64 * 1024)
      received.push(bytes)
    }
    const joined = Buffer.concat(received.map((value) => Buffer.from(value))).toString('utf8')
    expect(joined).toBe(body)

    transport.close()
  }, 15_000)

  it('records a relay limit close and backs off before reconnecting', async () => {
    const hub = await startHub()
    const logs: string[] = []
    const transport = createTransport(hub, logs)

    transport.start()
    const hello = await hub.hello()
    await hub.sendSealed(hello, { type: 'ready', agent: { version: 'test', protocol: 4 } })
    await waitFor(() => logs.includes('adapter authenticated'))

    const closedAt = Date.now()
    hub.closeClient(4008, 'rate limit')
    await waitFor(() => logs.includes('adapter disconnected (4008 rate limit)'))
    expect(transport.status.lastDisconnect).toMatchObject({
      code: 4008,
      reason: 'rate limit',
    })

    await waitFor(() => hub.connectionCount() >= 2, 6_000)
    // A relay refusal must not reset backoff on the next TCP open.
    expect(Date.now() - closedAt).toBeGreaterThanOrEqual(1_000)

    transport.close()
  }, 15_000)
})

function createTransport(
  hub: { wsUrl: string; key: string },
  logs: string[],
  handler: (request: Request) => Promise<Response> = async () =>
    new Response('{}', { status: 200 }),
  options: {
    grant?: string
    host?: AdapterHostIdentity
    onRelayGrant?: (grant: RelayGrantState) => void
    onHubInfo?: (info: AgentInfo) => void
  } = {}
): AdapterTransport {
  return new AdapterTransport({
    wsUrl: hub.wsUrl,
    ...(options.grant ? { grant: options.grant } : {}),
    identity: { harnessId: 'harness', adapterId: 'adapter', key: hub.key },
    kind: 'opencode',
    label: 'OpenCode',
    info: {
      adapterVersion: 'test',
      protocolVersion: 1,
      capabilities: {},
      ...(options.host ? { host: options.host } : {}),
    },
    handler,
    ...(options.onRelayGrant ? { onRelayGrant: options.onRelayGrant } : {}),
    ...(options.onHubInfo ? { onHubInfo: options.onHubInfo } : {}),
    log: (message) => logs.push(message),
  })
}

type StartHubOptions = { corruptMac?: boolean }

async function startHub(options: StartHubOptions = {}): Promise<FakeHub> {
  const key = generateKey()
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 })
  await new Promise<void>((resolve) => server.once('listening', resolve))
  const address = server.address()
  if (typeof address === 'string' || !address) throw new Error('The test hub did not bind')

  const sockets = new Set<WebSocket>()
  const protocols: Array<string | undefined> = []
  let client: WebSocket | undefined
  let keys: V4SessionKeys | undefined
  const clientFrames: ClientFrame[] = []
  const arrival: number[] = []
  let resolveHello!: (hello: Hello) => void
  const hello = new Promise<Hello>((resolve) => {
    resolveHello = resolve
  })

  server.on('connection', (socket, request) => {
    client = socket
    sockets.add(socket)
    protocols.push(request.headers['sec-websocket-protocol'])
    socket.on('message', (data) => {
      void handleFrame(data.toString())
    })

    async function handleFrame(text: string): Promise<void> {
      const frame = JSON.parse(text) as {
        t?: string
        sid?: string
        nonce?: string
        eph?: string
        seq?: number
        iv?: string
        ct?: string
      }
      if (frame.t === 'hello' && frame.sid && frame.nonce && frame.eph) {
        const agentNonce = bytesToBase64Url(randomBytes(16))
        const ephemeral = await generateEphemeralKeyPair()
        const input = {
          staticKey: key,
          sid: frame.sid,
          nonceC: frame.nonce,
          nonceS: agentNonce,
          ephC: frame.eph,
          ephS: ephemeral.publicKey,
          privateKey: ephemeral.privateKey,
          peerPublicKey: frame.eph,
        }
        const material = await deriveV4SessionKeys(input)
        const mac = options.corruptMac
          ? (await deriveV4SessionKeys({ ...input, staticKey: generateKey() })).mac
          : material.mac
        keys = material.keys
        socket.send(
          JSON.stringify({
            t: 'hello',
            v: PROTOCOL_VERSION,
            sid: frame.sid,
            nonce: agentNonce,
            role: 'agent',
            eph: ephemeral.publicKey,
            mac,
          })
        )
        resolveHello({
          sid: frame.sid,
          clientNonce: frame.nonce,
          agentNonce,
          clientEph: frame.eph,
          ephemeral,
          keys: material.keys,
        })
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
    sendSealed: async (value, payload, sendOptions = {}) => {
      const seq = sendOptions.seq ?? 0
      const sessionKeys = sendOptions.signingKey
        ? (
            await deriveV4SessionKeys({
              staticKey: sendOptions.signingKey,
              sid: value.sid,
              nonceC: value.clientNonce,
              nonceS: value.agentNonce,
              ephC: value.clientEph,
              ephS: value.ephemeral.publicKey,
              privateKey: value.ephemeral.privateKey,
              peerPublicKey: value.clientEph,
            })
          ).keys
        : value.keys
      const box = await seal(
        sessionKeys.s2c,
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
    dropClient: () => {
      client?.terminate()
    },
    closeClient: (code, reason) => {
      client?.close(code, reason)
    },
    isOpen: () => client?.readyState === WebSocket.OPEN,
    protocols: () => protocols.slice(),
    connectionCount: () => protocols.length,
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
      for (const socket of sockets) socket.terminate()
      sockets.clear()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
  hubs.push(hub)
  return hub
}

/**
 * Refuses the WebSocket upgrade with an HTTP status, which is what the relay
 * returns for a grant it cannot verify. ws reports a non-101 response instead
 * of a close frame, so the adapter has to treat it as a fatal auth refusal.
 */
async function startRejectingHub(statusCode: number): Promise<{
  wsUrl: string
  upgrades: () => number
  close: () => Promise<void>
}> {
  let upgrades = 0
  const server: Server = createServer((_request, response) => {
    response.statusCode = 404
    response.end()
  })
  server.on('upgrade', (_request, socket) => {
    upgrades += 1
    socket.write(
      `HTTP/1.1 ${statusCode} Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`
    )
    socket.destroy()
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (typeof address === 'string' || !address) throw new Error('The rejecting hub did not bind')
  const entry = {
    wsUrl: `ws://127.0.0.1:${address.port}`,
    upgrades: () => upgrades,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
  rejections.push(entry)
  return entry
}

async function waitFor(check: () => boolean, timeoutMs = 10_000): Promise<void> {
  const started = Date.now()
  while (!check()) {
    if (Date.now() - started > timeoutMs) throw new Error('Timed out waiting for adapter state')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}
