import { createServer, type Server } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
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
import {
  PROTOCOL_VERSION,
  type ClaraAction,
  type ClaraState,
  type WireFrame,
} from '@clara/shared-types'
import { Agent, type AgentPolicy } from '../src/agent.ts'
import { createApiApp } from '../src/api/app.ts'
import type { ApiApp } from '../src/api/context.ts'
import type { HarnessManager } from '../src/harness/manager.ts'
import { HarnessUnconfiguredError } from '../src/harness/types.ts'
import { OpenCodeClient, type HttpRequestAction } from '../src/opencode.ts'
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
  const client = new OpenCodeClient(url)
  return {
    configured,
    request: (action: HttpRequestAction, signal: AbortSignal) => {
      if (!configured) return Promise.reject(new HarnessUnconfiguredError())
      return client.request(action, signal)
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

const agents: Agent[] = []
const tempDirs: string[] = []
const databases: ClaraDatabase[] = []

const DEVICE_ID = 'test-device-000000'

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
  const sid = 'test-session'
  const clientNonce = bytesToBase64Url(randomBytes(16))
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

  agent.handleMessage(
    JSON.stringify({
      t: 'hello',
      v: PROTOCOL_VERSION,
      sid,
      nonce: clientNonce,
      role: 'client',
      deviceId: DEVICE_ID,
    })
  )

  const hello = await waitFor(() => frames.find((frame) => frame.t === 'hello'))
  if (hello.t !== 'hello') throw new Error('No hello frame')
  const keys = await deriveSessionKeys({
    key,
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
      const sid = 'policy-session'
      const clientNonce = bytesToBase64Url(randomBytes(16))
      const frames: WireFrame[] = []
      const agent = new Agent({
        api: fakeApi(fake, true, () => false),
        devices: testDevices(key),
        info: { version: 'test', protocol: PROTOCOL_VERSION },
        send: (frame) => frames.push(frame),
        policy: { canPush: () => false },
      })
      agents.push(agent)
      agent.handleMessage(
        JSON.stringify({
          t: 'hello',
          v: PROTOCOL_VERSION,
          sid,
          nonce: clientNonce,
          role: 'client',
          deviceId: DEVICE_ID,
        })
      )
      const hello = await waitFor(() => frames.find((frame) => frame.t === 'hello'))
      if (hello.t !== 'hello') throw new Error('No hello frame')
      const keys = await deriveSessionKeys({
        key,
        sid,
        clientNonce,
        agentNonce: hello.nonce,
      })
      const client: Client = { sid, keys, sendSeq: 0, receiveSeq: 0 }
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
    agents.push(agent)

    try {
      const enrollSid = 'enroll-session'
      const enrollNonce = bytesToBase64Url(randomBytes(16))
      agent.handleMessage(
        JSON.stringify({
          t: 'hello',
          v: PROTOCOL_VERSION,
          sid: enrollSid,
          nonce: enrollNonce,
          role: 'client',
          enrollId: token.id,
        })
      )
      const enrollHello = await waitFor(() => frames.find((frame) => frame.t === 'hello'))
      if (enrollHello.t !== 'hello') throw new Error('No enrollment hello')
      const enrollClient: Client = {
        sid: enrollSid,
        keys: await deriveSessionKeys({
          key: token.token,
          sid: enrollSid,
          clientNonce: enrollNonce,
          agentNonce: enrollHello.nonce,
        }),
        sendSeq: 0,
        receiveSeq: 0,
      }
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

      // The pairing session has no purpose after the response is delivered and
      // must not linger in the panel until the idle sweep.
      await waitFor(() =>
        agent.getSnapshot().some((session) => session.sid === enrollSid) ? undefined : true
      )

      const deviceSid = 'device-session'
      const deviceNonce = bytesToBase64Url(randomBytes(16))
      const helloCount = frames.filter((frame) => frame.t === 'hello').length
      agent.handleMessage(
        JSON.stringify({
          t: 'hello',
          v: PROTOCOL_VERSION,
          sid: deviceSid,
          nonce: deviceNonce,
          role: 'client',
          deviceId,
        })
      )
      const deviceHello = await waitFor(
        () => frames.filter((frame) => frame.t === 'hello')[helloCount]
      )
      if (deviceHello.t !== 'hello') throw new Error('No device hello')
      const deviceClient: Client = {
        sid: deviceSid,
        keys: await deriveSessionKeys({
          key: active?.key ?? '',
          sid: deviceSid,
          clientNonce: deviceNonce,
          agentNonce: deviceHello.nonce,
        }),
        sendSeq: 0,
        receiveSeq: 0,
      }
      await send(deviceClient, agent, { type: 'ready.ack', agent: { version: 'web', protocol: 2 } })
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
