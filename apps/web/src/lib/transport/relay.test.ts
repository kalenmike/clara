import 'fake-indexeddb/auto'
import { createServer, type Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { WebSocketServer, type WebSocket } from 'ws'
import {
  bytesToBase64Url,
  deriveV4SessionKeys,
  generateEphemeralKeyPair,
  generateKey,
  importSessionKey,
  open,
  randomBytes,
  seal,
  utf8,
  type SessionKeys,
} from '@clara/crypto'
import {
  PROTOCOL_VERSION,
  PROTOCOL_VERSION_V4,
  type ClientHelloFrameV4,
  type ClaraAction,
  type ClaraState,
  type DeviceErrorCode,
  type HubHelloFrameV4,
  type RelayGrantState,
} from '@clara/shared-types'
import { clearDevice, loadDevice, saveDevice, type StoredDevice } from '../device-store.ts'
import { createRelayTransport, MAX_IN_FLIGHT_REQUESTS, type RelayTransport } from './relay.ts'

type Greet = (socket: WebSocket, sid: string) => boolean

type RelayOptions = {
  /** Send a hub hello with a MAC that cannot verify. */
  tamperMac?: boolean
  /** Attach a refreshed grant to the sealed `ready` action. */
  readyGrant?: RelayGrantState
  /** Override the grant offered in the WebSocket subprotocol. */
  grant?: string
  onGrant?: (grant: RelayGrantState) => void
  onProtocols?: (protocols: string[]) => void
  onSealed?: () => void
}

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
    grant: 'test-grant',
    credential: {
      kind: 'device',
      deviceId: 'device-test',
      key: await importSessionKey(deviceKey),
    },
  })
})

afterAll(async () => {
  transport.close()
  await clearDevice()
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

  it('updates the hub info from an agent.status frame', async () => {
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

describe('relay grant handshake', () => {
  it('presents the grant and persists the grant refreshed in ready', async () => {
    const readyGrant: RelayGrantState = {
      grant: `${bytesToBase64Url(randomBytes(8))}.signature`,
      expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
    }
    let protocols: string[] = []
    const updates: RelayGrantState[] = []
    const key = await importSessionKey(deviceKey)
    const stored: StoredDevice = {
      deviceId: 'device-test',
      label: 'Test device',
      wsUrl: 'ws://placeholder/ws',
      room: 'room-1',
      grant: 'old-grant',
      grantExpiresAt: 1,
      fingerprint: 'fingerprint',
      key,
      createdAt: 1,
    }

    const relay = await startRelay(undefined, {
      grant: 'grant-abc',
      readyGrant,
      onProtocols: (value) => {
        protocols = value
      },
      onGrant: (grant) => {
        updates.push(grant)
        void saveDevice({
          ...stored,
          grant: grant.grant,
          grantExpiresAt: grant.expiresAt,
        })
      },
    })

    try {
      await relay.transport.connect()
      expect(protocols).toContain('clara.auth.grant-abc')

      const response = await relay.transport.fetch('http://clara.relay/api/info', {
        signal: AbortSignal.timeout(3_000),
      })
      expect(response.status).toBe(200)
      expect(updates).toEqual([readyGrant])

      const loaded = await waitForDeviceGrant(readyGrant.grant)
      expect(loaded.grantExpiresAt).toBe(readyGrant.expiresAt)
    } finally {
      await relay.close()
      await clearDevice()
    }
  }, 15_000)

  it('rejects a hello whose MAC does not verify and opens no session', async () => {
    let sealed = 0
    const relay = await startRelay(undefined, {
      tamperMac: true,
      onSealed: () => {
        sealed += 1
      },
    })

    try {
      await relay.transport.connect().catch(() => {})
      await waitFor(() => relay.transport.status().state === 'reconnecting', 5_000)
      expect(relay.transport.status().state).toBe('reconnecting')
      expect(sealed).toBe(0)
      await expect(
        relay.transport.fetch('http://clara.relay/api/info', {
          signal: AbortSignal.timeout(1_500),
        })
      ).rejects.toThrow()
      expect(relay.transport.status().state).not.toBe('open')
    } finally {
      await relay.close()
    }
  }, 15_000)
})

describe('relay transport device errors', () => {
  it('reconnects after a transient device error for its own session', async () => {
    let attempts = 0
    const relay = await startRelay((socket, sid) => {
      attempts += 1
      if (attempts === 1) {
        sendErrorFrame(socket, sid, 'invalid_device', 'This device is not allowed yet')
        return false
      }
      return true
    })

    try {
      await relay.transport.connect().catch(() => {})
      await waitFor(() => relay.transport.status().state === 'open', 10_000)
      expect(attempts).toBe(2)

      const response = await relay.transport.fetch('http://clara.relay/api/info', {
        signal: AbortSignal.timeout(3_000),
      })
      expect(response.status).toBe(200)
    } finally {
      await relay.close()
    }
  }, 15_000)

  it('stops after three consecutive credential-dead errors', async () => {
    let attempts = 0
    const relay = await startRelay((socket, sid) => {
      attempts += 1
      sendErrorFrame(socket, sid, 'revoked_device', 'This device was revoked')
      return false
    })

    try {
      await relay.transport.connect().catch(() => {})
      await waitFor(() => relay.transport.status().state === 'closed', 15_000)
      expect(attempts).toBe(3)
      expect(relay.transport.status().error).toMatch(/revoked/i)
      expect(relay.transport.status().error).toMatch(/re-pair/i)

      // A parked transport must not keep dialing the hub.
      await new Promise((resolve) => setTimeout(resolve, 1_500))
      expect(attempts).toBe(3)
      await expect(
        relay.transport.fetch('http://clara.relay/api/info', {
          signal: AbortSignal.timeout(3_000),
        })
      ).rejects.toThrow(/re-pair/i)
    } finally {
      await relay.close()
    }
  }, 20_000)

  it('reconnects when connect is called after a terminal error', async () => {
    let attempts = 0
    let revoked = true
    const relay = await startRelay((socket, sid) => {
      attempts += 1
      if (revoked) {
        sendErrorFrame(socket, sid, 'revoked_device', 'This device was revoked')
        return false
      }
      return true
    })

    try {
      await relay.transport.connect().catch(() => {})
      await waitFor(() => relay.transport.status().state === 'closed', 15_000)

      revoked = false
      await relay.transport.connect()
      expect(relay.transport.status().state).toBe('open')
      expect(attempts).toBe(4)

      const response = await relay.transport.fetch('http://clara.relay/api/info', {
        signal: AbortSignal.timeout(3_000),
      })
      expect(response.status).toBe(200)
    } finally {
      await relay.close()
    }
  }, 20_000)
})

async function waitFor(check: () => boolean, timeoutMs = 2_000): Promise<void> {
  const started = Date.now()
  while (!check()) {
    if (Date.now() - started > timeoutMs) throw new Error('Timed out waiting for the transport')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

async function waitForDeviceGrant(grant: string): Promise<StoredDevice> {
  const started = Date.now()
  while (Date.now() - started <= 2_000) {
    const loaded = await loadDevice()
    if (loaded?.grant === grant) return loaded
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('Timed out waiting for the refreshed grant')
}

/**
 * A relay that always completes the v4 handshake unless `greet` says otherwise
 * or the test asks for a bad hub MAC. `greet` runs on every client hello, which
 * lets a test fail the first attempts and then let the transport recover.
 */
async function startRelay(
  greet?: Greet,
  options: RelayOptions = {}
): Promise<{
  transport: RelayTransport
  close: () => Promise<void>
}> {
  const httpServer = createServer()
  const wsServer = new WebSocketServer({
    server: httpServer,
    handleProtocols: (protocols) => {
      const values = [...protocols]
      options.onProtocols?.(values)
      return values[0] ?? false
    },
  })
  wsServer.on('connection', (socket) =>
    attachFakeAgent(socket, deviceKey, { ...options, ...(greet ? { greet } : {}) })
  )
  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve))
  const address = httpServer.address()
  if (!address || typeof address === 'string') throw new Error('No test server address')

  const created = createRelayTransport({
    wsUrl: `ws://127.0.0.1:${address.port}/ws`,
    grant: options.grant ?? 'test-grant',
    ...(options.onGrant ? { onRelayGrant: options.onGrant } : {}),
    credential: {
      kind: 'device',
      deviceId: 'device-test',
      key: await importSessionKey(deviceKey),
    },
  })

  return {
    transport: created,
    close: async () => {
      created.close()
      await new Promise<void>((resolve) => wsServer.close(() => resolve()))
      await new Promise<void>((resolve) => httpServer.close(() => resolve()))
    },
  }
}

function sendErrorFrame(
  socket: WebSocket,
  sid: string,
  code: DeviceErrorCode,
  message: string
): void {
  socket.send(
    JSON.stringify({
      t: 'error',
      v: PROTOCOL_VERSION,
      sid,
      code,
      message,
    })
  )
}

function attachFakeAgent(
  socket: WebSocket,
  key: string,
  options: RelayOptions & { greet?: Greet } = {}
): void {
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
      if (options.greet && !options.greet(socket, sid)) return
      const hello = frame as unknown as ClientHelloFrameV4
      const ephemeral = await generateEphemeralKeyPair()
      const agentNonce = bytesToBase64Url(randomBytes(16))
      const material = await deriveV4SessionKeys({
        staticKey: key,
        sid,
        nonceC: hello.nonce,
        nonceS: agentNonce,
        ephC: hello.eph,
        ephS: ephemeral.publicKey,
        privateKey: ephemeral.privateKey,
        peerPublicKey: hello.eph,
      })
      const hubHello: HubHelloFrameV4 = {
        t: 'hello',
        v: PROTOCOL_VERSION_V4,
        sid,
        nonce: agentNonce,
        role: 'agent',
        eph: ephemeral.publicKey,
        mac: options.tamperMac ? bytesToBase64Url(randomBytes(32)) : material.mac,
      }
      socket.send(JSON.stringify(hubHello))
      if (options.tamperMac) return
      keys = material.keys
      send({
        type: 'ready',
        agent: { version: 'test', protocol: PROTOCOL_VERSION },
        ...(options.readyGrant ? { relayGrant: options.readyGrant } : {}),
      })
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
    options.onSealed?.()
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
