import { describe, expect, it } from 'vitest'
import {
  ReplayGuard,
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
  isHelloFrame,
  isSealedFrame,
  type AdapterAction,
  type AdapterEnrollAction,
  type AdapterState,
  type ClaraState,
  type WireFrame,
} from '@clara/shared-types'
import { Agent, type AdapterSessionHandler } from '../src/agent.ts'
import type { ApiApp } from '../src/api/context.ts'

const PAIR_ID = 'pair-1'
const PAIR_TOKEN = generateKey()
const ADAPTER_KEY = generateKey()

function api(): ApiApp {
  return {
    fetch: async () => new Response(null, { status: 204 }),
    openapi: async () => ({}),
  }
}

function devices() {
  return {
    findPairingToken: async () => undefined,
    findActiveDevice: async () => undefined,
    isActive: () => false,
    enrollDevice: async () => {
      throw new Error('not used')
    },
    touchDevice: () => undefined,
    revokeDevice: () => undefined,
    pruneExpiredTokens: () => 0,
  } as never
}

async function waitFor<T>(
  read: () => T | undefined | Promise<T | undefined>,
  timeout = 1_000
): Promise<T> {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    const value = await read()
    if (value !== undefined) return value
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error('Timed out')
}

type Client = {
  sid: string
  keys: SessionKeys
  sendSeq: number
  receive: ReplayGuard
  seen: Set<number>
}

async function connect(
  agent: Agent,
  frames: WireFrame[],
  identity: { enrollId?: string; adapterId?: string; key: string }
): Promise<Client> {
  const sid = bytesToBase64Url(randomBytes(16))
  const clientNonce = bytesToBase64Url(randomBytes(16))
  agent.handleMessage(
    JSON.stringify({
      t: 'hello',
      v: PROTOCOL_VERSION,
      sid,
      nonce: clientNonce,
      role: 'client',
      adapter: true,
      ...(identity.enrollId ? { enrollId: identity.enrollId } : {}),
      ...(identity.adapterId ? { adapterId: identity.adapterId } : {}),
    })
  )
  const hello = await waitFor(() => {
    const found = frames.find(
      (frame) => isHelloFrame(frame) && frame.sid === sid && frame.role === 'agent'
    )
    return found && isHelloFrame(found) ? found : undefined
  })
  const keys = await deriveSessionKeys({
    key: identity.key,
    sid,
    clientNonce,
    agentNonce: hello.nonce,
  })
  return { sid, keys, sendSeq: 0, receive: new ReplayGuard(), seen: new Set() }
}

async function send(client: Client, agent: Agent, payload: unknown): Promise<void> {
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

async function states(
  client: Client,
  frames: WireFrame[]
): Promise<Array<ClaraState | AdapterAction | AdapterState>> {
  const result: Array<ClaraState | AdapterAction | AdapterState> = []
  for (const frame of frames) {
    if (!isSealedFrame(frame) || frame.sid !== client.sid) continue
    if (client.seen.has(frame.seq)) continue
    client.seen.add(frame.seq)
    client.receive.check(frame.seq)
    const plaintext = await open(
      client.keys.s2c,
      { sid: client.sid, direction: 's2c', seq: frame.seq },
      { iv: frame.iv, ct: frame.ct }
    )
    result.push(
      JSON.parse(new TextDecoder().decode(plaintext)) as ClaraState | AdapterAction | AdapterState
    )
  }
  return result
}

describe('adapter sessions', () => {
  it('enrolls an adapter through the one-time pairing token', async () => {
    const frames: WireFrame[] = []
    const enrolled: AdapterEnrollAction[] = []
    const adapters: AdapterSessionHandler = {
      pairingToken: async (id) => (id === PAIR_ID ? PAIR_TOKEN : undefined),
      credential: async () => undefined,
      enroll: async (action) => {
        enrolled.push(action)
        return {
          connection: { id: 'connection-1', harnessId: action.harnessId, label: action.label },
          reconnected: false,
        }
      },
      setLive: async () => undefined,
      clearLive: async () => undefined,
    }
    const agent = new Agent({
      api: api(),
      devices: devices(),
      info: { version: 'test', protocol: PROTOCOL_VERSION },
      send: (frame) => frames.push(frame),
      adapters,
    })

    try {
      const client = await connect(agent, frames, { enrollId: PAIR_ID, key: PAIR_TOKEN })
      await send(client, agent, {
        type: 'adapter.enroll',
        id: PAIR_ID,
        harnessId: 'harness-a',
        kind: 'opencode',
        label: 'OpenCode',
        credentialId: 'adapter-a',
        key: ADAPTER_KEY,
        adapterVersion: '0.1.0',
        protocolVersion: 1,
        capabilities: {},
      })
      const received = await waitFor(async () => {
        const value = await states(client, frames)
        return value.some((state) => state.type === 'adapter.enrolled') ? value : undefined
      })
      expect(received.some((state) => state.type === 'adapter.enrolled')).toBe(true)
      expect(enrolled[0]?.harnessId).toBe('harness-a')
    } finally {
      agent.close()
    }
  })

  it('clears the live adapter when its transport socket closes', async () => {
    const frames: WireFrame[] = []
    let live: ((request: Request) => Promise<Response>) | undefined
    const cleared: string[] = []
    const adapters: AdapterSessionHandler = {
      pairingToken: async () => undefined,
      credential: async (id) =>
        id === 'adapter-a'
          ? { adapterId: 'adapter-a', harnessId: 'harness-a', key: ADAPTER_KEY }
          : undefined,
      enroll: async () => {
        throw new Error('not used')
      },
      setLive: async (_harnessId, fetch) => {
        live = fetch
      },
      clearLive: async (harnessId) => {
        live = undefined
        cleared.push(harnessId)
      },
    }
    const agent = new Agent({
      api: api(),
      devices: devices(),
      info: { version: 'test', protocol: PROTOCOL_VERSION },
      send: (frame) => frames.push(frame),
      adapters,
    })

    try {
      const client = await connect(agent, frames, { adapterId: 'adapter-a', key: ADAPTER_KEY })
      await waitFor(() => live)
      agent.disconnect(client.sid)
      await waitFor(() => (cleared.length > 0 ? true : undefined))
      expect(cleared).toEqual(['harness-a'])
      expect(agent.sessionCount).toBe(0)
    } finally {
      agent.close()
    }
  })

  it('carries a hub request over the live adapter session', async () => {
    const frames: WireFrame[] = []
    let live: ((request: Request) => Promise<Response>) | undefined
    const adapters: AdapterSessionHandler = {
      pairingToken: async () => undefined,
      credential: async (id) =>
        id === 'adapter-a'
          ? { adapterId: 'adapter-a', harnessId: 'harness-a', key: ADAPTER_KEY }
          : undefined,
      enroll: async () => {
        throw new Error('not used')
      },
      setLive: async (_harnessId, fetch) => {
        live = fetch
      },
      clearLive: async () => {
        live = undefined
      },
    }
    const agent = new Agent({
      api: api(),
      devices: devices(),
      info: { version: 'test', protocol: PROTOCOL_VERSION },
      send: (frame) => frames.push(frame),
      adapters,
    })

    try {
      const client = await connect(agent, frames, { adapterId: 'adapter-a', key: ADAPTER_KEY })
      const fetch = await waitFor(() => live)
      const pending = fetch(new Request('http://adapter/harness/v1/info'))
      const request = await waitFor(async () => {
        const value = await states(client, frames)
        const found = value.find((state) => state.type === 'adapter.request')
        return found && found.type === 'adapter.request' ? found : undefined
      })
      expect(request.type).toBe('adapter.request')
      if (request.type !== 'adapter.request') throw new Error('no request')
      await send(client, agent, {
        type: 'adapter.response',
        id: request.id,
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'application/json' },
      })
      await send(client, agent, {
        type: 'adapter.chunk',
        id: request.id,
        data: bytesToBase64Url(utf8(JSON.stringify({ protocol: 1 }))),
      })
      await send(client, agent, { type: 'adapter.end', id: request.id })
      const response = await pending
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ protocol: 1 })
    } finally {
      agent.close()
    }
  })
})
