import { createServer, type Server } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
import { Agent, type AgentPolicy } from '../src/agent.ts'
import { OpenCodeClient } from '../src/opencode.ts'
import type { PushService } from '../src/push/service.ts'
import {
  ClientStorageStore,
  MAX_SYNC_ENTRIES_PER_PUSH,
  MAX_SYNC_VALUE_BYTES,
} from '../src/store/client-storage.ts'
import { closeDatabase, openDatabase, type ClaraDatabase } from '../src/store/database.ts'

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
const tempDirs: string[] = []
const databases: ClaraDatabase[] = []

async function connect(
  fake: FakeOpenCode,
  push?: PushService,
  sync?: ClientStorageStore,
  policy?: AgentPolicy
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
    sync,
    ...(policy ? { policy } : {}),
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
  for (const db of databases.splice(0)) closeDatabase(db)
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
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

  it('refuses a command request when the shell policy is off', async () => {
    const fake = await startFakeOpenCode()
    try {
      let denied = 0
      const { agent, client, frames } = await connect(fake, undefined, undefined, {
        shellPolicy: () => ({ mode: 'off', commands: [] }),
        onShellDenied: () => {
          denied += 1
        },
      })
      await waitFor(() => (frames.length >= 2 ? true : undefined))
      await send(client, agent, { type: 'ready.ack', agent: { version: 'web', protocol: 1 } })
      await send(client, agent, {
        type: 'http.request',
        id: 'shell-off',
        method: 'POST',
        path: '/api/shell',
        search: '?location%5Bdirectory%5D=%2Ftmp',
        body: bytesToBase64Url(utf8(JSON.stringify({ command: 'git log' }))),
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
      expect(JSON.parse(body)).toMatchObject({ error: { code: 'shell_disabled' } })
      expect(denied).toBe(1)
    } finally {
      await fake.close()
    }
  })

  it('forwards an allowlisted command to OpenCode', async () => {
    const fake = await startFakeOpenCode()
    try {
      let denied = 0
      const { agent, client, frames } = await connect(fake, undefined, undefined, {
        shellPolicy: () => ({ mode: 'allowlist', commands: ['git log'] }),
        onShellDenied: () => {
          denied += 1
        },
      })
      await waitFor(() => (frames.length >= 2 ? true : undefined))
      await send(client, agent, { type: 'ready.ack', agent: { version: 'web', protocol: 1 } })
      await send(client, agent, {
        type: 'http.request',
        id: 'shell-allowed',
        method: 'POST',
        path: '/api/shell',
        search: '?location%5Bdirectory%5D=%2Ftmp',
        body: bytesToBase64Url(
          utf8(JSON.stringify({ command: 'git log --oneline -n 10', cwd: '/tmp' }))
        ),
      })

      const states = await waitFor(async () => {
        const parsed = await readStates(client, frames)
        return parsed.some((state) => state.type === 'http.end') ? parsed : undefined
      })

      // The fake OpenCode server has no /api/shell route, so a 404 proves the
      // request reached it instead of being refused by the policy.
      const response = states.find((state) => state.type === 'http.response')
      expect(response && response.type === 'http.response' ? response.status : undefined).toBe(404)
      expect(denied).toBe(0)
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

  it('rejects proxying and push when the runtime policy disables them', async () => {
    const fake = await startFakeOpenCode()
    try {
      const psk = generatePsk()
      const sid = 'policy-session'
      const clientNonce = bytesToBase64Url(randomBytes(16))
      const frames: WireFrame[] = []
      const agent = new Agent({
        openCode: new OpenCodeClient(fake.url),
        psk,
        info: { version: 'test', protocol: PROTOCOL_VERSION },
        send: (frame) => frames.push(frame),
        policy: { canProxy: () => false, canPush: () => false },
      })
      agents.push(agent)
      agent.handleMessage(
        JSON.stringify({
          t: 'hello',
          v: PROTOCOL_VERSION,
          sid,
          nonce: clientNonce,
          role: 'client',
        })
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
      await waitFor(() => (frames.length >= 2 ? true : undefined))

      await send(client, agent, {
        type: 'http.request',
        id: 'disabled-1',
        method: 'GET',
        path: '/api/info',
      })
      const states = await waitFor(async () => {
        const parsed = await readStates(client, frames)
        return parsed.some((state) => state.type === 'http.error') ? parsed : undefined
      })
      expect(states).toContainEqual({
        type: 'http.error',
        id: 'disabled-1',
        code: 'disabled',
        message: 'OpenCode access is disabled by an admin setting',
      })

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
    type: 'sync.snapshot' | 'sync.error' | 'http.error'
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
        entries: [{ key: 'clara.connection.local', value: '{}' }],
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
})
