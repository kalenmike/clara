import { createServer, type Server } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  bytesToBase64Url,
  deriveV4SessionKeys,
  generateEphemeralKeyPair,
  generateKey,
  open,
  randomBytes,
  seal,
  utf8,
  verifyV4HelloMac,
  type SessionKeys,
  type V4EphemeralKeyPair,
} from '@clara/crypto'
import {
  PROTOCOL_VERSION,
  PROTOCOL_VERSION_V4,
  verifyRelayGrant,
  type AdapterAction,
  type AdapterState,
  type ClaraAction,
  type ClaraState,
  type ClientHelloFrameV4,
  type HubHelloFrameV4,
  type WireFrame,
} from '@clara/shared-types'
import {
  Agent,
  MAX_HELLOS_PER_WINDOW,
  MAX_SESSIONS,
  type AdapterSessionHandler,
  type AgentPolicy,
} from '../src/agent.ts'
import { createApiApp } from '../src/api/app.ts'
import type { ApiApp } from '../src/api/context.ts'
import type { HarnessManager } from '../src/harness/manager.ts'
import { HarnessUnconfiguredError } from '../src/harness/types.ts'
import type { PushService } from '../src/push/service.ts'
import {
  ClientStorageStore,
  MAX_SYNC_ENTRIES_PER_PUSH,
  MAX_SYNC_VALUE_BYTES,
} from '../src/store/client-storage.ts'
import { closeDatabase, openDatabase, type ClaraDatabase } from '../src/store/database.ts'
import type { DeviceRegistry } from '../src/store/devices.ts'
import { TrafficMeter } from '../src/traffic.ts'

function fakeHarness(url: string, configured = true): HarnessManager {
  return {
    configured,
    request: (
      input: { method: string; path: string; search?: string; body?: string },
      signal: AbortSignal
    ) => {
      if (!configured) return Promise.reject(new HarnessUnconfiguredError())
      const path =
        input.path === '/harness/info'
          ? '/api/info'
          : input.path === '/projects'
            ? '/api/project'
            : input.path === '/sessions'
              ? '/api/session'
              : input.path === '/events'
                ? '/api/stream'
                : `/api${input.path}`
      return fetch(`${url}${path}${input.search ?? ''}`, {
        method: input.method,
        ...(input.body ? { body: input.body } : {}),
        signal,
      })
    },
  } as unknown as HarnessManager
}

function fakeApi(
  fake: FakeOpenCode,
  configured = true,
  canAccess: () => boolean = () => true
): ApiApp {
  return createApiApp(
    {
      harness: fakeHarness(fake.url, configured),
      info: { version: 'test', protocol: PROTOCOL_VERSION },
      startedAt: Date.now(),
      canAccess,
      sessionCount: () => 0,
      log: () => undefined,
    },
    { token: 'test-token' }
  )
}

function heldApi(): ApiApp {
  return {
    fetch: async (request) => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          request.signal.addEventListener('abort', () => {
            try {
              controller.error(new DOMException('Aborted', 'AbortError'))
            } catch {
              // The stream may already be closed.
            }
          })
        },
      })
      return new Response(stream, { status: 200 })
    },
    openapi: async () => ({}),
  }
}

function streamApi(chunks: string[]): ApiApp {
  const encoder = new TextEncoder()
  return {
    fetch: async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
            controller.close()
          },
        }),
        { status: 200, headers: { 'content-type': 'text/event-stream' } }
      ),
    openapi: async () => ({}),
  }
}

type FakeOpenCode = {
  url: string
  close: () => Promise<void>
}

async function startFakeOpenCode(): Promise<FakeOpenCode> {
  const server = createServer((request, response) => {
    if (request.url === '/api/info') {
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ version: '9.9.9', pid: 42, urls: [], paths: { tmp: '/tmp' } }))
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
    if (request.url === '/api/hold') {
      const timer = setTimeout(() => {
        response.statusCode = 204
        response.end()
      }, 10_000)
      request.on('close', () => clearTimeout(timer))
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

type ClientIdentity =
  | { deviceId: string }
  | { enrollId: string }
  | { adapter: true; adapterId: string }
  | { adapter: true; enrollId: string }

/**
 * Drives a real v4 client handshake: fresh ephemeral P-256 pair, MAC check on
 * the hub hello, then the derived directional keys. Every test that opens a
 * session proves the hub hello MAC this way.
 */
async function openClient(
  agent: Agent,
  frames: WireFrame[],
  key: string,
  identity: ClientIdentity,
  options: {
    sid?: string
    deliver?: (hello: ClientHelloFrameV4) => void
  } = {}
): Promise<Client> {
  const sid = options.sid ?? bytesToBase64Url(randomBytes(16))
  const ephemeral = await generateEphemeralKeyPair()
  const hello: ClientHelloFrameV4 = {
    t: 'hello',
    v: PROTOCOL_VERSION_V4,
    sid,
    nonce: bytesToBase64Url(randomBytes(16)),
    role: 'client',
    eph: ephemeral.publicKey,
    ...identity,
  }

  const deliver =
    options.deliver ??
    ((value: ClientHelloFrameV4) => {
      agent.handleMessage(JSON.stringify(value))
    })
  deliver(hello)

  const hubHello = await waitFor(() =>
    frames.find(
      (frame): frame is HubHelloFrameV4 =>
        frame.t === 'hello' && frame.role === 'agent' && frame.sid === sid
    )
  )
  const keys = await completeHandshake(key, hello, hubHello, ephemeral)
  return { sid, keys, sendSeq: 0, receiveSeq: 0 }
}

/** Derive the client keys and prove the hub hello MAC before using the session. */
async function completeHandshake(
  key: string,
  hello: ClientHelloFrameV4,
  hubHello: HubHelloFrameV4,
  ephemeral: V4EphemeralKeyPair
): Promise<SessionKeys> {
  const input = {
    staticKey: key,
    sid: hello.sid,
    nonceC: hello.nonce,
    nonceS: hubHello.nonce,
    ephC: hello.eph,
    ephS: hubHello.eph,
    privateKey: ephemeral.privateKey,
    peerPublicKey: hubHello.eph,
  }
  const material = await deriveV4SessionKeys(input)
  expect(await verifyV4HelloMac({ ...input, mac: hubHello.mac })).toBe(true)
  return material.keys
}

const agents: Agent[] = []
const tempDirs: string[] = []
const databases: ClaraDatabase[] = []

const DEVICE_ID = 'test-device-000000'
const RELAY_ROOM = 'test-room'
const RELAY_AGENT_TOKEN = 'test-agent-token'

function testDevices(key: string, deviceId = DEVICE_ID): DeviceRegistry {
  return {
    findPairingToken: async () => undefined,
    findActiveDevice: async (id) =>
      id === deviceId
        ? { id, key, label: 'Test device', fingerprint: 'test-fingerprint' }
        : undefined,
    isActive: (id) => id === deviceId,
    enrollDevice: async () => {
      throw new Error('Enrollment is not used in this test')
    },
    touchDevice: () => {},
  }
}

async function connect(
  fake: FakeOpenCode,
  push?: PushService,
  sync?: ClientStorageStore,
  policy?: AgentPolicy,
  traffic?: TrafficMeter,
  configured = true,
  api?: ApiApp
): Promise<{
  agent: Agent
  client: Client
  frames: WireFrame[]
}> {
  const key = generateKey()
  const frames: WireFrame[] = []
  const agent = new Agent({
    api: api ?? fakeApi(fake, configured),
    devices: testDevices(key),
    info: { version: 'test', protocol: PROTOCOL_VERSION },
    send: (frame) => frames.push(frame),
    push,
    sync,
    ...(policy ? { policy } : {}),
    ...(traffic ? { traffic } : {}),
  })
  agents.push(agent)

  const client = await openClient(
    agent,
    frames,
    key,
    { deviceId: DEVICE_ID },
    {
      sid: 'test-session',
    }
  )
  return { agent, client, frames }
}

async function send(
  client: Client,
  agent: Agent,
  payload: ClaraAction | AdapterAction
): Promise<void> {
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

async function readPayloads(
  client: Client,
  frames: WireFrame[]
): Promise<Array<ClaraAction | ClaraState | AdapterState>> {
  const payloads: Array<ClaraAction | ClaraState | AdapterState> = []
  for (const frame of frames) {
    if (frame.t !== 'sealed' || frame.sid !== client.sid) continue
    const plaintext = await open(
      client.keys.s2c,
      { sid: client.sid, direction: 's2c', seq: frame.seq },
      frame
    )
    payloads.push(
      JSON.parse(new TextDecoder().decode(plaintext)) as ClaraAction | ClaraState | AdapterState
    )
  }
  return payloads
}

async function readStates(client: Client, frames: WireFrame[]): Promise<ClaraState[]> {
  const payloads = await readPayloads(client, frames)
  return payloads.filter(
    (payload) => payload.type !== 'ready' && payload.type !== 'ready.ack' && payload.type !== 'pong'
  ) as ClaraState[]
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
  for (const db of databases.splice(0)) closeDatabase(db)
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('agent', () => {
  it('returns a clear 503 when no harness is configured', async () => {
    const fake = await startFakeOpenCode()
    try {
      const { agent, client, frames } = await connect(
        fake,
        undefined,
        undefined,
        undefined,
        undefined,
        false
      )
      await waitFor(() => (frames.length >= 2 ? true : undefined))
      await send(client, agent, { type: 'ready.ack', agent: { version: 'web', protocol: 1 } })
      await send(client, agent, {
        type: 'http.request',
        id: 'unconfigured',
        method: 'GET',
        path: '/v1/harness/info',
      })

      const states = await waitFor(async () => {
        const parsed = await readStates(client, frames)
        return parsed.some((state) => state.type === 'http.end') ? parsed : undefined
      })
      const response = states.find((state) => state.type === 'http.response')
      expect(response && response.type === 'http.response' ? response.status : undefined).toBe(503)
      const body = states
        .filter((state) => state.type === 'http.chunk')
        .map((state) =>
          Buffer.from(state.type === 'http.chunk' ? state.data : '', 'base64url').toString('utf8')
        )
        .join('')
      expect(JSON.parse(body)).toMatchObject({ error: { code: 'harness_unconfigured' } })
    } finally {
      await fake.close()
    }
  })

  it('routes /v1 requests through the Clara API instead of the harness proxy', async () => {
    const fake = await startFakeOpenCode()
    try {
      const api: ApiApp = {
        fetch: async (request) =>
          new Response(JSON.stringify({ path: new URL(request.url).pathname }), {
            headers: { 'content-type': 'application/json' },
          }),
        openapi: async () => ({}),
      }
      const { agent, client, frames } = await connect(
        fake,
        undefined,
        undefined,
        undefined,
        undefined,
        true,
        api
      )
      await waitFor(() => (frames.length >= 2 ? true : undefined))
      await send(client, agent, { type: 'ready.ack', agent: { version: 'web', protocol: 1 } })
      await send(client, agent, {
        type: 'http.request',
        id: 'api-info',
        method: 'GET',
        path: '/v1/info',
      })

      const states = await waitFor(async () => {
        const parsed = await readStates(client, frames)
        return parsed.some((state) => state.type === 'http.end') ? parsed : undefined
      })
      const response = states.find((state) => state.type === 'http.response')
      expect(response && response.type === 'http.response' ? response.status : undefined).toBe(200)
      const body = states
        .filter((state) => state.type === 'http.chunk')
        .map((state) =>
          Buffer.from(state.type === 'http.chunk' ? state.data : '', 'base64url').toString('utf8')
        )
        .join('')
      expect(JSON.parse(body)).toEqual({ path: '/v1/info' })
    } finally {
      await fake.close()
    }
  })

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
        path: '/v1/harness/info',
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

  it('limits concurrent requests and records the refusal', async () => {
    const fake = await startFakeOpenCode()
    const traffic = new TrafficMeter()
    const { agent, client, frames } = await connect(
      fake,
      undefined,
      undefined,
      undefined,
      traffic,
      true,
      heldApi()
    )
    try {
      await waitFor(() => (frames.length >= 2 ? true : undefined))
      await send(client, agent, { type: 'ready.ack', agent: { version: 'web', protocol: 1 } })
      for (let index = 0; index < 70; index += 1) {
        await send(client, agent, {
          type: 'http.request',
          id: `hold-${index}`,
          method: 'GET',
          path: '/v1/events',
        })
      }

      const states = await waitFor(async () => {
        const parsed = await readStates(client, frames)
        return parsed.some((state) => state.type === 'http.error') ? parsed : undefined
      })
      expect(
        states.some((state) => state.type === 'http.error' && state.code === 'too_many_requests')
      ).toBe(true)
      expect(traffic.snapshot().errors.limited).toBeGreaterThan(0)
    } finally {
      agent.reset()
      await fake.close()
    }
  })

  it('streams a long-lived response', async () => {
    const fake = await startFakeOpenCode()
    try {
      const { agent, client, frames } = await connect(
        fake,
        undefined,
        undefined,
        undefined,
        undefined,
        true,
        streamApi(['data: one\n\n', 'data: two\n\n'])
      )
      await waitFor(() => (frames.length >= 2 ? true : undefined))
      await send(client, agent, { type: 'ready.ack', agent: { version: 'web', protocol: 1 } })
      await send(client, agent, {
        type: 'http.request',
        id: 'stream-1',
        method: 'GET',
        path: '/v1/events',
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
      let subscriptionMeta: { orchestrationOptIn?: boolean } | undefined
      const push = {
        subscribe: (_subscription: unknown, meta?: { orchestrationOptIn?: boolean }) => {
          subscriptionMeta = meta
          return { count: 1, endpoint }
        },
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
        orchestrationOptIn: true,
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
      expect(subscriptionMeta?.orchestrationOptIn).toBe(true)
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

  it('rejects paths outside the hub API', async () => {
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
        return parsed.some((state) => state.type === 'http.end') ? parsed : undefined
      })
      const response = states.find((state) => state.type === 'http.response')
      expect(response && response.type === 'http.response' ? response.status : undefined).toBe(404)
      const body = states
        .filter((state) => state.type === 'http.chunk')
        .map((state) => (state.type === 'http.chunk' ? state.data : ''))
        .map((data) => Buffer.from(data, 'base64url').toString('utf8'))
        .join('')
      expect(JSON.parse(body)).toMatchObject({ error: { code: 'not_found' } })
    } finally {
      await fake.close()
    }
  })

  it('rejects proxying and push when the runtime policy disables them', async () => {
    const fake = await startFakeOpenCode()
    try {
      const key = generateKey()
      const frames: WireFrame[] = []
      const agent = new Agent({
        api: fakeApi(fake, true, () => false),
        devices: testDevices(key),
        info: { version: 'test', protocol: PROTOCOL_VERSION },
        send: (frame) => frames.push(frame),
        policy: { canPush: () => false },
      })
      agents.push(agent)
      const client = await openClient(
        agent,
        frames,
        key,
        { deviceId: DEVICE_ID },
        {
          sid: 'policy-session',
        }
      )
      await waitFor(() => (frames.length >= 2 ? true : undefined))

      await send(client, agent, {
        type: 'http.request',
        id: 'disabled-1',
        method: 'GET',
        path: '/v1/harness/info',
      })
      const states = await waitFor(async () => {
        const parsed = await readStates(client, frames)
        return parsed.some((state) => state.type === 'http.end') ? parsed : undefined
      })
      const response = states.find((state) => state.type === 'http.response')
      expect(response && response.type === 'http.response' ? response.status : undefined).toBe(403)
      const body = states
        .filter((state) => state.type === 'http.chunk')
        .map((state) => (state.type === 'http.chunk' ? state.data : ''))
        .map((data) => Buffer.from(data, 'base64url').toString('utf8'))
        .join('')
      expect(JSON.parse(body)).toMatchObject({ error: { code: 'disabled' } })

      await send(client, agent, {
        type: 'push.test',
        id: 'push-disabled',
      })
      const pushStates = await waitFor(async () => {
        const parsed = await readStates(client, frames)
        return parsed.some((state) => state.type === 'push.status') ? parsed : undefined
      })
      expect(pushStates).toContainEqual({
        type: 'push.status',
        id: 'push-disabled',
        subscribed: false,
        tested: true,
        error: 'Push notifications are disabled by an admin setting',
      })
    } finally {
      await fake.close()
    }
  })
})

describe('agent client sync', () => {
  function openSync(): { store: ClientStorageStore; db: ClaraDatabase; path: string } {
    const dir = mkdtempSync(join(tmpdir(), 'clara-sync-'))
    tempDirs.push(dir)
    const path = join(dir, 'clara.db')
    const db = openDatabase(path)
    databases.push(db)
    return { store: new ClientStorageStore(db), db, path }
  }

  async function waitForState(
    client: Client,
    frames: WireFrame[],
    type: 'sync.revision' | 'sync.snapshot' | 'sync.error' | 'http.error'
  ): Promise<ClaraState> {
    return waitFor(async () => {
      const states = await readStates(client, frames)
      return states.find((state) => state.type === type)
    })
  }

  it('pulls, pushes, tombstones, and reports conflicts over an encrypted session', async () => {
    const fake = await startFakeOpenCode()
    const { store } = openSync()
    try {
      const { agent, client, frames } = await connect(fake, undefined, store)
      await waitFor(() => (frames.length >= 2 ? true : undefined))

      await send(client, agent, { type: 'sync.pull', id: 'pull-0' })
      const empty = await waitForState(client, frames, 'sync.snapshot')
      expect(empty).toMatchObject({
        type: 'sync.snapshot',
        id: 'pull-0',
        namespace: 'default',
        revision: 0,
        entries: [],
      })

      await send(client, agent, {
        type: 'sync.push',
        id: 'push-1',
        baseRevision: 0,
        entries: [{ key: 'clara.theme', value: 'dark' }],
      })
      const first = await waitFor(async () => {
        const states = await readStates(client, frames)
        return states.find((state) => state.type === 'sync.snapshot' && state.id === 'push-1')
      })
      expect(first).toMatchObject({
        type: 'sync.snapshot',
        id: 'push-1',
        revision: 1,
        entries: [{ key: 'clara.theme', value: 'dark' }],
      })
      expect(
        (first as Extract<ClaraState, { type: 'sync.snapshot' }>).entries[0]?.updatedAt
      ).toBeGreaterThan(0)

      await send(client, agent, {
        type: 'sync.push',
        id: 'push-2',
        namespace: 'default',
        baseRevision: 1,
        entries: [{ key: 'clara.colorTheme', value: 'nord' }],
      })
      const second = await waitFor(async () => {
        const states = await readStates(client, frames)
        return states.find((state) => state.type === 'sync.snapshot' && state.id === 'push-2')
      })
      expect(second).toMatchObject({
        type: 'sync.snapshot',
        id: 'push-2',
        revision: 2,
        entries: [
          { key: 'clara.colorTheme', value: 'nord' },
          { key: 'clara.theme', value: 'dark' },
        ],
      })

      await send(client, agent, {
        type: 'sync.push',
        id: 'push-3',
        baseRevision: 2,
        entries: [{ key: 'clara.theme', value: null }],
      })
      const third = await waitFor(async () => {
        const states = await readStates(client, frames)
        return states.find((state) => state.type === 'sync.snapshot' && state.id === 'push-3')
      })
      expect(third).toMatchObject({
        type: 'sync.snapshot',
        revision: 3,
        entries: [
          { key: 'clara.colorTheme', value: 'nord' },
          { key: 'clara.theme', value: null },
        ],
      })

      await send(client, agent, {
        type: 'sync.push',
        id: 'stale',
        baseRevision: 1,
        entries: [{ key: 'clara.theme', value: 'light' }],
      })
      const conflict = await waitFor(async () => {
        const states = await readStates(client, frames)
        return states.find((state) => state.type === 'sync.error' && state.id === 'stale')
      })
      expect(conflict).toMatchObject({
        type: 'sync.error',
        id: 'stale',
        code: 'conflict',
        namespace: 'default',
        revision: 3,
      })
      expect(
        (conflict as Extract<ClaraState, { type: 'sync.error' }>).entries?.find(
          (entry) => entry.key === 'clara.theme'
        )?.value
      ).toBeNull()
    } finally {
      await fake.close()
    }
  })

  it('rejects secret keys, oversized entries, and too many entries', async () => {
    const fake = await startFakeOpenCode()
    const { store } = openSync()
    try {
      const { agent, client, frames } = await connect(fake, undefined, store)
      await waitFor(() => (frames.length >= 2 ? true : undefined))

      await send(client, agent, {
        type: 'sync.push',
        id: 'secret',
        entries: [{ key: 'clara.device.credential', value: '{}' }],
      })
      const secret = await waitForState(client, frames, 'sync.error')
      expect(secret).toMatchObject({ type: 'sync.error', id: 'secret', code: 'invalid' })

      await send(client, agent, {
        type: 'sync.push',
        id: 'too-large',
        entries: [{ key: 'clara.theme', value: 'x'.repeat(MAX_SYNC_VALUE_BYTES + 1) }],
      })
      const tooLarge = await waitFor(async () => {
        const states = await readStates(client, frames)
        return states.find((state) => state.type === 'sync.error' && state.id === 'too-large')
      })
      expect(tooLarge).toMatchObject({ type: 'sync.error', code: 'too_large' })

      await send(client, agent, {
        type: 'sync.push',
        id: 'too-many',
        entries: Array.from({ length: MAX_SYNC_ENTRIES_PER_PUSH + 1 }, (_, index) => ({
          key: `key-${index}`,
          value: 'v',
        })),
      })
      const tooMany = await waitFor(async () => {
        const states = await readStates(client, frames)
        return states.find((state) => state.type === 'sync.error' && state.id === 'too-many')
      })
      expect(tooMany).toMatchObject({ type: 'sync.error', code: 'too_large' })
    } finally {
      await fake.close()
    }
  })

  it('reports only the revision for a sync check', async () => {
    const fake = await startFakeOpenCode()
    const { store } = openSync()
    try {
      store.push({
        type: 'sync.push',
        id: 'seed',
        entries: [{ key: 'clara.theme', value: 'dark' }],
      })
      const { agent, client, frames } = await connect(fake, undefined, store)
      await waitFor(() => (frames.length >= 2 ? true : undefined))

      await send(client, agent, { type: 'sync.check', id: 'check-1' })
      const state = await waitFor(async () => {
        const states = await readStates(client, frames)
        return states.find((item) => item.type === 'sync.revision' && item.id === 'check-1')
      })
      expect(state).toEqual({
        type: 'sync.revision',
        id: 'check-1',
        namespace: 'default',
        revision: 1,
      })
    } finally {
      await fake.close()
    }
  })

  it('rejects sync actions when an admin disables sync', async () => {
    const fake = await startFakeOpenCode()
    const { store } = openSync()
    try {
      const { agent, client, frames } = await connect(fake, undefined, store, {
        canSync: () => false,
      })
      await waitFor(() => (frames.length >= 2 ? true : undefined))

      const actions: Array<{ id: string; action: ClaraAction }> = [
        { id: 'disabled-check', action: { type: 'sync.check', id: 'disabled-check' } },
        { id: 'disabled-pull', action: { type: 'sync.pull', id: 'disabled-pull' } },
        {
          id: 'disabled-push',
          action: {
            type: 'sync.push',
            id: 'disabled-push',
            entries: [{ key: 'clara.theme', value: 'dark' }],
          },
        },
      ]

      for (const entry of actions) {
        await send(client, agent, entry.action)
        const state = await waitFor(async () => {
          const states = await readStates(client, frames)
          return states.find((item) => item.type === 'sync.error' && item.id === entry.id)
        })
        expect(state).toMatchObject({ type: 'sync.error', id: entry.id, code: 'disabled' })
      }
    } finally {
      await fake.close()
    }
  })

  it('broadcasts the current hub info to connected clients', async () => {
    const fake = await startFakeOpenCode()
    try {
      const { agent, client, frames } = await connect(fake)
      await waitFor(() => (frames.length >= 2 ? true : undefined))

      agent.broadcastAgentInfo()
      const state = await waitFor(async () => {
        const states = await readStates(client, frames)
        return states.find((item) => item.type === 'agent.status')
      })
      expect(state).toMatchObject({
        type: 'agent.status',
        online: true,
        agent: { version: 'test', protocol: PROTOCOL_VERSION },
      })
    } finally {
      await fake.close()
    }
  })

  it('reports storage when the sync store is unavailable', async () => {
    const fake = await startFakeOpenCode()
    try {
      const { agent, client, frames } = await connect(fake)
      await waitFor(() => (frames.length >= 2 ? true : undefined))
      await send(client, agent, { type: 'sync.pull', id: 'no-store' })
      const state = await waitForState(client, frames, 'sync.error')
      expect(state).toMatchObject({ type: 'sync.error', id: 'no-store', code: 'storage' })
    } finally {
      await fake.close()
    }
  })

  it('persists synced values and tombstones across a store reopen', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'clara-sync-reopen-'))
    tempDirs.push(dir)
    const path = join(dir, 'clara.db')
    const first = openDatabase(path)
    const store = new ClientStorageStore(first)
    expect(
      store.push({
        type: 'sync.push',
        id: 'one',
        entries: [
          { key: 'clara.theme', value: 'dark' },
          { key: 'clara.sidebar', value: '{"width":300}' },
        ],
      })
    ).toMatchObject({ ok: true })
    expect(
      store.push({
        type: 'sync.push',
        id: 'two',
        baseRevision: 1,
        entries: [{ key: 'clara.sidebar', value: null }],
      })
    ).toMatchObject({ ok: true })
    closeDatabase(first)

    const second = openDatabase(path)
    databases.push(second)
    const reopened = new ClientStorageStore(second)
    const result = reopened.pull(undefined)
    expect(result).toMatchObject({ ok: true })
    if (!result.ok) throw new Error('Expected a snapshot')
    expect(result.snapshot.revision).toBe(2)
    expect(result.snapshot.entries).toEqual([
      expect.objectContaining({ key: 'clara.sidebar', value: null }),
      expect.objectContaining({ key: 'clara.theme', value: 'dark' }),
    ])
  })

  it('counts frames, requests, and per-session traffic in the meter', async () => {
    const fake = await startFakeOpenCode()
    try {
      const traffic = new TrafficMeter()
      const { agent, client, frames } = await connect(
        fake,
        undefined,
        undefined,
        undefined,
        traffic
      )
      await waitFor(() => (frames.length >= 2 ? true : undefined))
      await send(client, agent, { type: 'ready.ack', agent: { version: 'web', protocol: 1 } })
      await send(client, agent, {
        type: 'http.request',
        id: 'request-metered',
        method: 'GET',
        path: '/v1/harness/info',
      })
      await waitFor(async () => {
        const states = await readStates(client, frames)
        return states.some((state) => state.type === 'http.end') ? states : undefined
      })

      const snapshot = traffic.snapshot()
      expect(snapshot.enabled).toBe(true)
      expect(snapshot.totals.requests).toBe(1)
      expect(snapshot.totals.framesIn).toBeGreaterThan(1)
      expect(snapshot.byTransport.local.requests).toBe(1)
      expect(snapshot.byTransport.relay.requests).toBe(0)
      expect(snapshot.totals.sessionsOpened).toBe(1)

      const [session] = agent.getSnapshot()
      expect(session).toMatchObject({ requestsTotal: 1 })
      expect(session?.bytesIn).toBeGreaterThan(0)
      expect(session?.bytesOut).toBeGreaterThan(0)
    } finally {
      await fake.close()
    }
  })

  it('keeps session counters frozen while monitoring is off', async () => {
    const fake = await startFakeOpenCode()
    try {
      const traffic = new TrafficMeter({ enabled: false })
      const { agent, client, frames } = await connect(
        fake,
        undefined,
        undefined,
        undefined,
        traffic
      )
      await waitFor(() => (frames.length >= 2 ? true : undefined))
      await send(client, agent, { type: 'ready.ack', agent: { version: 'web', protocol: 1 } })
      await send(client, agent, {
        type: 'http.request',
        id: 'request-unmetered',
        method: 'GET',
        path: '/v1/harness/info',
      })
      await waitFor(async () => {
        const states = await readStates(client, frames)
        return states.some((state) => state.type === 'http.end') ? states : undefined
      })

      expect(traffic.snapshot().enabled).toBe(false)
      expect(traffic.snapshot().totals.requests).toBe(0)
      const [session] = agent.getSnapshot()
      expect(session).toMatchObject({ bytesIn: 0, bytesOut: 0, requestsTotal: 0 })
    } finally {
      await fake.close()
    }
  })

  it('enrolls a device over a one-time token and rejects it after revocation', async () => {
    const fake = await startFakeOpenCode()
    const token = {
      id: 'enroll-1',
      token: generateKey(),
      fingerprint: 'enroll-fingerprint',
      expiresAt: Date.now() + 60_000,
    }
    let active: { id: string; key: string; label: string; fingerprint: string } | undefined
    const devices: DeviceRegistry = {
      findPairingToken: async (id) => (id === token.id ? token : undefined),
      findActiveDevice: async (id) => (active?.id === id ? active : undefined),
      isActive: (id) => active?.id === id,
      enrollDevice: async (input) => {
        active = {
          id: input.deviceId,
          key: input.key,
          label: input.label,
          fingerprint: 'device-fingerprint',
        }
        return {
          id: input.deviceId,
          label: input.label,
          fingerprint: 'device-fingerprint',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          lastSeenAt: Date.now(),
        }
      },
      touchDevice: () => {},
    }
    const frames: WireFrame[] = []
    const agent = new Agent({
      api: fakeApi(fake),
      devices,
      info: { version: 'test', protocol: PROTOCOL_VERSION },
      send: (frame) => frames.push(frame),
    })
    agent.setGrantIssuer({ room: RELAY_ROOM, agentToken: RELAY_AGENT_TOKEN })
    agents.push(agent)

    try {
      const enrollSid = 'enroll-session'
      const enrollClient = await openClient(
        agent,
        frames,
        token.token,
        { enrollId: token.id },
        { sid: enrollSid }
      )
      const deviceId = 'device-enrolled-0001'
      const enrollmentKey = generateKey()
      await send(enrollClient, agent, {
        type: 'device.enroll',
        deviceId,
        key: enrollmentKey,
        label: 'Desk',
      })
      const enrolled = await waitFor(async () => {
        const states = await readStates(enrollClient, frames)
        return states.find((state) => state.type === 'device.enrolled')
      })
      expect(enrolled).toMatchObject({ deviceId, label: 'Desk' })
      expect(active?.id).toBe(deviceId)
      expect(active?.key).toBe(enrollmentKey)

      // The enrollment grant was scoped to the pairing id, so the response
      // must hand over the first grant scoped to the new device id.
      const enrolledGrant = enrolled.type === 'device.enrolled' ? enrolled.relayGrant : undefined
      expect(enrolledGrant).toBeDefined()
      const verifiedEnrollment = await verifyRelayGrant(enrolledGrant!.grant, {
        agentToken: RELAY_AGENT_TOKEN,
        room: RELAY_ROOM,
      })
      expect(verifiedEnrollment).toEqual({
        ok: true,
        payload: expect.objectContaining({ id: deviceId }),
      })

      // The pairing session has no purpose after the response is delivered and
      // must not linger in the panel until the idle sweep.
      await waitFor(() =>
        agent.getSnapshot().some((session) => session.sid === enrollSid) ? undefined : true
      )

      const deviceSid = 'device-session'
      const deviceClient = await openClient(
        agent,
        frames,
        active?.key ?? '',
        { deviceId },
        { sid: deviceSid }
      )

      // A reconnect refreshes the grant in `ready`, still scoped to the device.
      const ready = await waitFor(async () => {
        const payloads = await readPayloads(deviceClient, frames)
        return payloads.find((payload) => payload.type === 'ready')
      })
      const refreshed = ready.type === 'ready' ? ready.relayGrant : undefined
      expect(refreshed).toBeDefined()
      const verifiedRefresh = await verifyRelayGrant(refreshed!.grant, {
        agentToken: RELAY_AGENT_TOKEN,
        room: RELAY_ROOM,
      })
      expect(verifiedRefresh).toEqual({
        ok: true,
        payload: expect.objectContaining({ id: deviceId }),
      })

      await send(deviceClient, agent, {
        type: 'ready.ack',
        agent: { version: 'web', protocol: PROTOCOL_VERSION },
      })
      await send(deviceClient, agent, {
        type: 'http.request',
        id: 'device-request',
        method: 'GET',
        path: '/v1/harness/info',
      })
      await waitFor(async () => {
        const states = await readStates(deviceClient, frames)
        return states.some((state) => state.type === 'http.end') ? states : undefined
      })

      active = undefined
      frames.length = 0
      await send(deviceClient, agent, {
        type: 'http.request',
        id: 'revoked-request',
        method: 'GET',
        path: '/v1/harness/info',
      })
      const error = await waitFor(() => frames.find((frame) => frame.t === 'error'))
      expect(error).toMatchObject({ code: 'revoked_device' })
      expect(agent.getSnapshot().some((session) => session.sid === deviceSid)).toBe(false)
    } finally {
      await fake.close()
    }
  })
})

describe('agent adapter enrollment', () => {
  it('delivers the first adapter grant in the enrollment response', async () => {
    const fake = await startFakeOpenCode()
    try {
      const pairId = 'pair-1'
      const pairToken = generateKey()
      const adapterKey = generateKey()
      const adapters: AdapterSessionHandler = {
        pairingToken: async (id) => (id === pairId ? pairToken : undefined),
        credential: async () => undefined,
        enroll: async (action) => ({
          connection: { id: 'connection-1', harnessId: action.harnessId, label: action.label },
          reconnected: false,
        }),
        setLive: async () => undefined,
        clearLive: async () => undefined,
      }
      const frames: WireFrame[] = []
      const agent = new Agent({
        api: fakeApi(fake),
        devices: testDevices(generateKey()),
        info: { version: 'test', protocol: PROTOCOL_VERSION },
        send: (frame) => frames.push(frame),
        adapters,
      })
      agent.setGrantIssuer({ room: RELAY_ROOM, agentToken: RELAY_AGENT_TOKEN })
      agents.push(agent)

      const client = await openClient(
        agent,
        frames,
        pairToken,
        { adapter: true, enrollId: pairId },
        { sid: 'adapter-enroll' }
      )
      await send(client, agent, {
        type: 'adapter.enroll',
        id: pairId,
        harnessId: 'harness-a',
        kind: 'opencode',
        label: 'OpenCode',
        credentialId: 'adapter-a',
        key: adapterKey,
        adapterVersion: '0.1.0',
        protocolVersion: 1,
        capabilities: {},
      })

      const enrolled = await waitFor(async () => {
        const payloads = await readPayloads(client, frames)
        return payloads.find((payload) => payload.type === 'adapter.enrolled')
      })
      const grant = enrolled.type === 'adapter.enrolled' ? enrolled.relayGrant : undefined
      expect(grant).toBeDefined()
      const verified = await verifyRelayGrant(grant!.grant, {
        agentToken: RELAY_AGENT_TOKEN,
        room: RELAY_ROOM,
      })
      expect(verified).toEqual({
        ok: true,
        payload: expect.objectContaining({ id: 'adapter-a' }),
      })
    } finally {
      await fake.close()
    }
  })
})

describe('agent relay envelope', () => {
  const PEER_A = 'peer-aaaaaaaaaaaaaaaaaaaa'
  const PEER_B = 'peer-bbbbbbbbbbbbbbbbbbbb'

  function route(
    peer: string,
    frame: WireFrame | ClientHelloFrameV4 | string,
    grantId = DEVICE_ID
  ): string {
    const m = typeof frame === 'string' ? frame : JSON.stringify(frame)
    return JSON.stringify({ t: 'route', v: PROTOCOL_VERSION, p: peer, i: grantId, m })
  }

  function routeBytes(
    peer: string,
    frame: WireFrame | ClientHelloFrameV4 | string,
    grantId = DEVICE_ID
  ): string {
    const text = typeof frame === 'string' ? frame : JSON.stringify(frame)
    return JSON.stringify({
      t: 'route',
      v: PROTOCOL_VERSION,
      p: peer,
      i: grantId,
      b: true,
      m: Buffer.from(text, 'utf8').toString('base64url'),
    })
  }

  function relayAgent(
    fake: FakeOpenCode,
    key: string,
    frames: WireFrame[],
    traffic?: TrafficMeter,
    log?: (message: string, detail?: unknown) => void
  ): Agent {
    const agent = new Agent({
      api: fakeApi(fake),
      devices: testDevices(key),
      info: { version: 'test', protocol: PROTOCOL_VERSION },
      send: (frame) => frames.push(frame),
      ...(traffic ? { traffic } : {}),
      ...(log ? { log } : {}),
    })
    agent.setEnvelope('relay')
    agents.push(agent)
    return agent
  }

  async function relayConnect(
    fake: FakeOpenCode,
    peer: string,
    options: {
      sid?: string
      key?: string
      traffic?: TrafficMeter
      log?: (message: string, detail?: unknown) => void
      frame?: (peer: string, value: WireFrame | ClientHelloFrameV4, grantId?: string) => string
      grantId?: string
    } = {}
  ): Promise<{ agent: Agent; client: Client; frames: WireFrame[] }> {
    const key = options.key ?? generateKey()
    const frames: WireFrame[] = []
    const agent = relayAgent(fake, key, frames, options.traffic, options.log)
    const wrap = options.frame ?? route
    const grantId = options.grantId ?? DEVICE_ID
    const client = await openClient(
      agent,
      frames,
      key,
      { deviceId: DEVICE_ID },
      {
        ...(options.sid ? { sid: options.sid } : { sid: 'relay-session' }),
        deliver: (hello) => agent.handleMessage(wrap(peer, hello, grantId)),
      }
    )
    return { agent, client, frames }
  }

  async function sendRelay(
    client: Client,
    agent: Agent,
    peer: string,
    payload: ClaraAction,
    wrap: (peer: string, value: WireFrame) => string = route
  ): Promise<void> {
    const seq = client.sendSeq
    client.sendSeq += 1
    const box = await seal(
      client.keys.c2s,
      { sid: client.sid, direction: 'c2s', seq },
      utf8(JSON.stringify(payload))
    )
    agent.handleMessage(
      wrap(peer, {
        t: 'sealed',
        v: PROTOCOL_VERSION,
        sid: client.sid,
        seq,
        iv: box.iv,
        ct: box.ct,
      })
    )
  }

  function garbageSealed(client: Client, seq: number): WireFrame {
    return {
      t: 'sealed',
      v: PROTOCOL_VERSION,
      sid: client.sid,
      seq,
      iv: 'AAAAAAAAAAAAAAAA',
      ct: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    }
  }

  it('drops a relay frame that has no verified grant id', async () => {
    const fake = await startFakeOpenCode()
    try {
      const key = generateKey()
      const frames: WireFrame[] = []
      const agent = relayAgent(fake, key, frames)
      const ephemeral = await generateEphemeralKeyPair()
      const hello: ClientHelloFrameV4 = {
        t: 'hello',
        v: PROTOCOL_VERSION_V4,
        sid: 'missing-grant',
        nonce: bytesToBase64Url(randomBytes(16)),
        role: 'client',
        eph: ephemeral.publicKey,
        deviceId: DEVICE_ID,
      }
      // No `i`: the hub cannot tell which credential opened the socket.
      agent.handleMessage(
        JSON.stringify({ t: 'route', v: PROTOCOL_VERSION, p: PEER_A, m: JSON.stringify(hello) })
      )
      await new Promise((resolve) => setTimeout(resolve, 20))

      expect(frames).toHaveLength(0)
      expect(agent.sessionCount).toBe(0)
    } finally {
      await fake.close()
    }
  })

  it('rejects a hello whose identity differs from the grant id', async () => {
    const fake = await startFakeOpenCode()
    try {
      const key = generateKey()
      const frames: WireFrame[] = []
      const agent = relayAgent(fake, key, frames)
      const ephemeral = await generateEphemeralKeyPair()
      const sid = 'identity-mismatch'
      agent.handleMessage(
        route(
          PEER_A,
          {
            t: 'hello',
            v: PROTOCOL_VERSION_V4,
            sid,
            nonce: bytesToBase64Url(randomBytes(16)),
            role: 'client',
            eph: ephemeral.publicKey,
            deviceId: DEVICE_ID,
          },
          'attacker-identity'
        )
      )

      const error = await waitFor(() =>
        frames.find((frame) => frame.t === 'error' && frame.sid === sid)
      )
      expect(error).toMatchObject({ code: 'invalid_device' })
      // No hub hello and no session: the handshake must fail before key setup.
      expect(frames.some((frame) => frame.t === 'hello')).toBe(false)
      expect(agent.sessionCount).toBe(0)
    } finally {
      await fake.close()
    }
  })

  it('macs the hub hello so only the holder of the static key accepts it', async () => {
    const fake = await startFakeOpenCode()
    try {
      const key = generateKey()
      const frames: WireFrame[] = []
      const agent = relayAgent(fake, key, frames)
      const ephemeral = await generateEphemeralKeyPair()
      const hello: ClientHelloFrameV4 = {
        t: 'hello',
        v: PROTOCOL_VERSION_V4,
        sid: 'mac-session',
        nonce: bytesToBase64Url(randomBytes(16)),
        role: 'client',
        eph: ephemeral.publicKey,
        deviceId: DEVICE_ID,
      }
      agent.handleMessage(route(PEER_A, hello))

      const hubHello = await waitFor(() =>
        frames.find(
          (frame): frame is HubHelloFrameV4 =>
            frame.t === 'hello' && frame.role === 'agent' && frame.sid === hello.sid
        )
      )
      const input = {
        sid: hello.sid,
        nonceC: hello.nonce,
        nonceS: hubHello.nonce,
        ephC: hello.eph,
        ephS: hubHello.eph,
        privateKey: ephemeral.privateKey,
        peerPublicKey: hubHello.eph,
      }

      expect(await verifyV4HelloMac({ ...input, staticKey: key, mac: hubHello.mac })).toBe(true)
      expect(
        await verifyV4HelloMac({ ...input, staticKey: generateKey(), mac: hubHello.mac })
      ).toBe(false)
    } finally {
      await fake.close()
    }
  })

  it('drops a sealed frame from another peer without touching the session', async () => {
    const fake = await startFakeOpenCode()
    try {
      const traffic = new TrafficMeter()
      const logs: Array<{ message: string; detail?: unknown }> = []
      const { agent, client, frames } = await relayConnect(fake, PEER_A, {
        traffic,
        log: (message, detail) => logs.push({ message, detail }),
      })

      // The relay reports PEER_B as the sender, so this cannot be served as
      // PEER_A's frame even though the payload names PEER_A's sid.
      agent.handleMessage(route(PEER_B, garbageSealed(client, 0)))
      await new Promise((resolve) => setTimeout(resolve, 20))

      expect(frames.some((frame) => frame.t === 'error')).toBe(false)
      expect(agent.getSnapshot()).toHaveLength(1)
      expect(traffic.snapshot().errors.misrouted).toBe(1)
      const dropped = logs.find((entry) => entry.message.includes('another relay peer'))
      expect(dropped?.detail).toBe(`sid=${client.sid} grant=${DEVICE_ID}`)

      await sendRelay(client, agent, PEER_A, {
        type: 'ready.ack',
        agent: { version: 'web', protocol: PROTOCOL_VERSION },
      })
      await sendRelay(client, agent, PEER_A, {
        type: 'http.request',
        id: 'after-misroute',
        method: 'GET',
        path: '/v1/harness/info',
      })
      const states = await waitFor(async () => {
        const parsed = await readStates(client, frames)
        return parsed.some((state) => state.type === 'http.end') ? parsed : undefined
      })
      expect(states.some((state) => state.type === 'http.response' && state.status === 200)).toBe(
        true
      )
    } finally {
      await fake.close()
    }
  })

  it('drops a hello that reuses a live session sid from another peer', async () => {
    const fake = await startFakeOpenCode()
    try {
      const { agent, client, frames } = await relayConnect(fake, PEER_A)
      const hellosBefore = frames.filter((frame) => frame.t === 'hello').length
      const ephemeral = await generateEphemeralKeyPair()

      agent.handleMessage(
        route(PEER_B, {
          t: 'hello',
          v: PROTOCOL_VERSION_V4,
          sid: client.sid,
          nonce: bytesToBase64Url(randomBytes(16)),
          role: 'client',
          eph: ephemeral.publicKey,
          deviceId: DEVICE_ID,
        })
      )
      await new Promise((resolve) => setTimeout(resolve, 30))

      expect(frames.filter((frame) => frame.t === 'hello')).toHaveLength(hellosBefore)
      expect(frames.some((frame) => frame.t === 'error')).toBe(false)
      expect(agent.getSnapshot()).toHaveLength(1)

      await sendRelay(client, agent, PEER_A, {
        type: 'ready.ack',
        agent: { version: 'web', protocol: PROTOCOL_VERSION },
      })
      await sendRelay(client, agent, PEER_A, {
        type: 'http.request',
        id: 'after-hello',
        method: 'GET',
        path: '/v1/harness/info',
      })
      const states = await waitFor(async () => {
        const parsed = await readStates(client, frames)
        return parsed.some((state) => state.type === 'http.end') ? parsed : undefined
      })
      expect(states.some((state) => state.type === 'http.response' && state.status === 200)).toBe(
        true
      )
    } finally {
      await fake.close()
    }
  })

  it('ignores unwrapped frames in relay mode and logs once', async () => {
    const fake = await startFakeOpenCode()
    try {
      const frames: WireFrame[] = []
      const logs: string[] = []
      const agent = new Agent({
        api: fakeApi(fake),
        devices: testDevices(generateKey()),
        info: { version: 'test', protocol: PROTOCOL_VERSION },
        send: (frame) => frames.push(frame),
        log: (message) => logs.push(message),
      })
      agent.setEnvelope('relay')
      agents.push(agent)

      const hello = JSON.stringify({
        t: 'hello',
        v: PROTOCOL_VERSION,
        sid: 'unwrapped-session',
        nonce: bytesToBase64Url(randomBytes(16)),
        role: 'client',
        deviceId: DEVICE_ID,
      })
      agent.handleMessage(hello)
      agent.handleMessage(hello)
      // A route frame without a peer is not a route frame either.
      agent.handleMessage(JSON.stringify({ t: 'route', v: PROTOCOL_VERSION, p: '', m: hello }))

      expect(frames).toHaveLength(0)
      expect(agent.sessionCount).toBe(0)
      expect(logs.filter((message) => message.includes('unwrapped'))).toHaveLength(1)
    } finally {
      await fake.close()
    }
  })

  it('unwraps a binary route frame from the relay', async () => {
    const fake = await startFakeOpenCode()
    try {
      const { agent, client, frames } = await relayConnect(fake, PEER_A, { frame: routeBytes })
      await sendRelay(
        client,
        agent,
        PEER_A,
        { type: 'ready.ack', agent: { version: 'web', protocol: PROTOCOL_VERSION } },
        routeBytes
      )
      await sendRelay(
        client,
        agent,
        PEER_A,
        { type: 'http.request', id: 'binary-route', method: 'GET', path: '/v1/harness/info' },
        routeBytes
      )
      const states = await waitFor(async () => {
        const parsed = await readStates(client, frames)
        return parsed.some((state) => state.type === 'http.end') ? parsed : undefined
      })
      expect(states.some((state) => state.type === 'http.response' && state.status === 200)).toBe(
        true
      )
    } finally {
      await fake.close()
    }
  })

  it('does not unwrap route frames on the local transport', async () => {
    const fake = await startFakeOpenCode()
    try {
      const frames: WireFrame[] = []
      const traffic = new TrafficMeter()
      const key = generateKey()
      const agent = new Agent({
        api: fakeApi(fake),
        devices: testDevices(key),
        info: { version: 'test', protocol: PROTOCOL_VERSION },
        send: (frame) => frames.push(frame),
        traffic,
      })
      agents.push(agent)

      const wrapped = route(PEER_A, {
        t: 'hello',
        v: PROTOCOL_VERSION,
        sid: 'local-session',
        nonce: bytesToBase64Url(randomBytes(16)),
        role: 'client',
        deviceId: DEVICE_ID,
      })
      agent.handleMessage(wrapped)

      expect(frames).toHaveLength(0)
      expect(agent.sessionCount).toBe(0)
      expect(traffic.snapshot().errors.dropped).toBe(1)
    } finally {
      await fake.close()
    }
  })
})

describe('agent relay limits', () => {
  function route(peer: string, frame: WireFrame | ClientHelloFrameV4, grantId = DEVICE_ID): string {
    return JSON.stringify({
      t: 'route',
      v: PROTOCOL_VERSION,
      p: peer,
      i: grantId,
      m: JSON.stringify(frame),
    })
  }

  async function helloFrame(sid: string): Promise<ClientHelloFrameV4> {
    const ephemeral = await generateEphemeralKeyPair()
    return {
      t: 'hello',
      v: PROTOCOL_VERSION_V4,
      sid,
      nonce: bytesToBase64Url(randomBytes(16)),
      role: 'client',
      eph: ephemeral.publicKey,
      deviceId: DEVICE_ID,
    }
  }

  function relayAgent(
    fake: FakeOpenCode,
    key: string,
    frames: WireFrame[],
    devices?: DeviceRegistry,
    log?: (message: string, detail?: unknown) => void
  ): Agent {
    const agent = new Agent({
      api: fakeApi(fake),
      devices: devices ?? testDevices(key),
      info: { version: 'test', protocol: PROTOCOL_VERSION },
      send: (frame) => frames.push(frame),
      ...(log ? { log } : {}),
    })
    agent.setEnvelope('relay')
    agents.push(agent)
    return agent
  }

  async function sendSealed(
    client: Client,
    agent: Agent,
    peer: string,
    payload: ClaraAction
  ): Promise<void> {
    const seq = client.sendSeq
    client.sendSeq += 1
    const box = await seal(
      client.keys.c2s,
      { sid: client.sid, direction: 'c2s', seq },
      utf8(JSON.stringify(payload))
    )
    agent.handleMessage(
      route(peer, {
        t: 'sealed',
        v: PROTOCOL_VERSION,
        sid: client.sid,
        seq,
        iv: box.iv,
        ct: box.ct,
      })
    )
  }

  it('refuses a hello past the session cap and keeps the live sessions working', async () => {
    const fake = await startFakeOpenCode()
    try {
      const key = generateKey()
      const frames: WireFrame[] = []
      const agent = relayAgent(fake, key, frames)
      const sessions: Array<{ client: Client; peer: string }> = []

      for (let index = 0; index < MAX_SESSIONS; index += 1) {
        const sid = `cap-${index}`
        const peer = `peer-cap-${String(index).padStart(4, '0')}`
        const client = await openClient(
          agent,
          frames,
          key,
          { deviceId: DEVICE_ID },
          {
            sid,
            deliver: (hello) => agent.handleMessage(route(peer, hello)),
          }
        )
        sessions.push({ client, peer })
      }
      expect(agent.sessionCount).toBe(MAX_SESSIONS)

      // `device_limit` means the device registry is full and is treated as a
      // credential-dead code, so capacity uses the transient `not_allowed`.
      agent.handleMessage(route('peer-over', await helloFrame('cap-over')))
      const error = await waitFor(() =>
        frames.find((frame) => frame.t === 'error' && frame.sid === 'cap-over')
      )
      expect(error).toMatchObject({
        t: 'error',
        code: 'not_allowed',
        message: 'The hub is at its session limit; retry shortly',
      })
      expect(agent.sessionCount).toBe(MAX_SESSIONS)
      expect(agent.getSnapshot().some((session) => session.sid === 'cap-over')).toBe(false)

      const first = sessions[0]
      if (!first) throw new Error('No session')
      await sendSealed(first.client, agent, first.peer, {
        type: 'ready.ack',
        agent: { version: 'web', protocol: PROTOCOL_VERSION },
      })
      await sendSealed(first.client, agent, first.peer, {
        type: 'http.request',
        id: 'cap-still-works',
        method: 'GET',
        path: '/v1/harness/info',
      })
      const states = await waitFor(async () => {
        const parsed = await readStates(first.client, frames)
        return parsed.some((state) => state.type === 'http.end') ? parsed : undefined
      })
      expect(states.some((state) => state.type === 'http.response' && state.status === 200)).toBe(
        true
      )
    } finally {
      await fake.close()
    }
  }, 20_000)

  it('drops hellos above the per-peer rate before database lookups', async () => {
    const fake = await startFakeOpenCode()
    try {
      const key = generateKey()
      const devices = testDevices(key)
      const findActiveDevice = vi.fn(devices.findActiveDevice)
      const frames: WireFrame[] = []
      const logs: Array<{ message: string; detail?: unknown }> = []
      const agent = relayAgent(
        fake,
        key,
        frames,
        { ...devices, findActiveDevice },
        (message, detail) => logs.push({ message, detail })
      )

      const peer = 'peer-rate'
      for (let index = 0; index < MAX_HELLOS_PER_WINDOW * 2; index += 1) {
        agent.handleMessage(route(peer, await helloFrame(`rate-${index}`)))
      }

      await waitFor(() => (agent.sessionCount === MAX_HELLOS_PER_WINDOW ? true : undefined))
      await new Promise((resolve) => setTimeout(resolve, 50))

      expect(findActiveDevice).toHaveBeenCalledTimes(MAX_HELLOS_PER_WINDOW)
      expect(agent.sessionCount).toBe(MAX_HELLOS_PER_WINDOW)
      const limited = logs.filter((entry) => entry.message.includes('relay peer limit'))
      expect(limited).toHaveLength(1)
      expect(limited[0]?.detail).toBe(`peer=${peer}`)
    } finally {
      await fake.close()
    }
  })

  it('does not apply relay hello limits on the local transport', async () => {
    const fake = await startFakeOpenCode()
    try {
      const key = generateKey()
      const devices = testDevices(key)
      const findActiveDevice = vi.fn(devices.findActiveDevice)
      const frames: WireFrame[] = []
      const agent = new Agent({
        api: fakeApi(fake),
        devices: { ...devices, findActiveDevice },
        info: { version: 'test', protocol: PROTOCOL_VERSION },
        send: (frame) => frames.push(frame),
      })
      agents.push(agent)

      // More hellos than both the per-peer budget and the relay session cap.
      const total = MAX_SESSIONS + 2
      for (let index = 0; index < total; index += 1) {
        agent.handleMessage(JSON.stringify(await helloFrame(`local-${index}`)))
      }

      await waitFor(() => (agent.sessionCount === total ? true : undefined))
      expect(findActiveDevice).toHaveBeenCalledTimes(total)
      expect(frames.some((frame) => frame.t === 'error')).toBe(false)
    } finally {
      await fake.close()
    }
  }, 20_000)
})
