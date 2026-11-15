import { env, runInDurableObject, SELF } from 'cloudflare:test'
import {
  PROTOCOL_VERSION,
  createRelayGrant,
  isRouteFrameV3,
  type RouteFrameV3,
} from '@clara/shared-types'
import { describe, expect, it } from 'vitest'
import type { Env } from '../src/env.ts'
import {
  CLIENT_FRAME_BURST,
  MAX_CLIENT_SOCKETS_PER_IP,
  MAX_CLIENT_SOCKETS_PER_ROOM,
} from '../src/room.ts'
import type { RelayRoom } from '../src/room.ts'

const AGENT_TOKEN = 'agent-test-token'
const MAX_CLIENT_FRAME_BYTES = 128 * 1024
const CLIENT_LIMIT_CODE = 4008

type Role = 'agent' | 'client'

type Connection = {
  socket: WebSocket
  response: Response
  /** Resolves with the close code even if the server closes immediately. */
  closed: Promise<number>
}

let grantCounter = 0

async function grantFor(room: string, id = `client-${(grantCounter += 1)}`): Promise<string> {
  const { grant } = await createRelayGrant({
    room,
    id,
    agentToken: AGENT_TOKEN,
    ttlSeconds: 600,
  })
  return grant
}

async function connectWithResponse(
  room: string,
  role: Role,
  credential?: string,
  headers: Record<string, string> = {},
  grantId?: string
): Promise<Connection> {
  const token = credential ?? (role === 'agent' ? AGENT_TOKEN : await grantFor(room, grantId))
  const response = await SELF.fetch(`https://relay.test/room/${room}`, {
    headers: {
      Upgrade: 'websocket',
      'Sec-WebSocket-Protocol': ['clara.v1', `clara.role.${role}`, `clara.auth.${token}`].join(
        ', '
      ),
      ...headers,
    },
  })
  expect(response.status).toBe(101)
  const socket = response.webSocket
  if (!socket) throw new Error('No WebSocket upgrade')
  const closed = new Promise<number>((resolve) => {
    socket.addEventListener('close', (event) => resolve(event.code), { once: true })
  })
  socket.accept()
  return { socket, response, closed }
}

async function connect(
  room: string,
  role: Role,
  credential?: string,
  headers: Record<string, string> = {}
): Promise<WebSocket> {
  const { socket } = await connectWithResponse(room, role, credential, headers)
  return socket
}

function nextMessage(socket: WebSocket): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out waiting for a message')), 2_000)
    socket.addEventListener(
      'message',
      (event) => {
        clearTimeout(timer)
        resolve(String(event.data))
      },
      { once: true }
    )
  })
}

async function nextRoute(socket: WebSocket): Promise<RouteFrameV3> {
  const parsed: unknown = JSON.parse(await nextMessage(socket))
  if (!isRouteFrameV3(parsed)) throw new Error('Expected a route frame')
  return parsed
}

function nextClose(socket: WebSocket): Promise<number> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out waiting for close')), 2_000)
    socket.addEventListener(
      'close',
      (event) => {
        clearTimeout(timer)
        resolve(event.code)
      },
      { once: true }
    )
  })
}

/** Keep a socket drained while a test sends a burst; returns the frames seen. */
function collectMessages(socket: WebSocket): string[] {
  const messages: string[] = []
  socket.addEventListener('message', (event) => {
    messages.push(String(event.data))
  })
  return messages
}

function routedPeer(messages: string[], text: string): string | undefined {
  for (const message of messages) {
    const parsed: unknown = JSON.parse(message)
    if (isRouteFrameV3(parsed) && parsed.m === text) return parsed.p
  }
  return undefined
}

/** Payloads the agent received from one grant id, in arrival order. */
function routedPayloads(messages: string[], grantId: string): string[] {
  const payloads: string[] = []
  for (const message of messages) {
    const parsed: unknown = JSON.parse(message)
    if (isRouteFrameV3(parsed) && parsed.i === grantId) payloads.push(parsed.m)
  }
  return payloads
}

/** Let in-flight frames drain before asserting what the agent received. */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 100))
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
  throw new Error('Timed out waiting for a message')
}

/** Read the room's in-memory limit state inside its Durable Object. */
async function peerStateCount(room: string): Promise<number> {
  const bindings = env as unknown as Env
  const stub = bindings.RELAY_ROOMS.get(bindings.RELAY_ROOMS.idFromName(room))
  return runInDurableObject(stub, (instance) => (instance as unknown as RelayRoom).peerStateCount)
}

describe('relay worker', () => {
  it('rejects a missing or wrong token', async () => {
    const response = await SELF.fetch('https://relay.test/room/auth-room', {
      headers: {
        Upgrade: 'websocket',
        'Sec-WebSocket-Protocol': 'clara.v1, clara.role.client, clara.auth.wrong',
      },
    })
    expect(response.status).toBe(401)
  })

  it('advertises the routing version on the upgrade response', async () => {
    const room = 'version-room'
    const agent = await connectWithResponse(room, 'agent')
    expect(agent.response.headers.get('x-clara-relay-version')).toBe('3')
    agent.socket.close(1000, 'done')
  })

  it('tags client frames with a per-socket peer and verified grant id', async () => {
    const room = 'routing-room'
    const agent = await connect(room, 'agent')
    const first = await connect(room, 'client', await grantFor(room, 'device-routing-1'))
    const second = await connect(room, 'client', await grantFor(room, 'device-routing-2'))

    first.send('from-first')
    const firstRoute = await nextRoute(agent)
    expect(firstRoute).toMatchObject({
      t: 'route',
      v: PROTOCOL_VERSION,
      i: 'device-routing-1',
      m: 'from-first',
    })
    expect(firstRoute.p).toMatch(/^[A-Za-z0-9_-]{22}$/)

    second.send('from-second')
    const secondRoute = await nextRoute(agent)
    expect(secondRoute.m).toBe('from-second')
    expect(secondRoute.i).toBe('device-routing-2')
    // The relay owns the peer id, so the hub can tell the two sockets apart.
    expect(secondRoute.p).not.toBe(firstRoute.p)

    const firstBroadcast = nextMessage(first)
    const secondBroadcast = nextMessage(second)
    agent.send('to-everyone')
    await expect(firstBroadcast).resolves.toBe('to-everyone')
    await expect(secondBroadcast).resolves.toBe('to-everyone')

    agent.close(1000, 'done')
    first.close(1000, 'done')
    second.close(1000, 'done')
  })

  it('overwrites a spoofed grant id header with the verified one', async () => {
    const room = 'grant-spoof-room'
    const agent = await connect(room, 'agent')
    const client = await connect(room, 'client', await grantFor(room, 'real-device'), {
      'x-clara-grant-id': 'forged-device',
    })

    client.send('spoof-check')
    const route = await nextRoute(agent)
    expect(route.i).toBe('real-device')

    agent.close(1000, 'done')
    client.close(1000, 'done')
  })

  it('wraps a forged route frame under the real sender peer', async () => {
    const room = 'spoof-room'
    const agent = await connect(room, 'agent')
    const victim = await connect(room, 'client')
    const attacker = await connect(room, 'client')

    victim.send('victim-frame')
    const victimRoute = await nextRoute(agent)

    const forged = JSON.stringify({
      t: 'route',
      v: PROTOCOL_VERSION,
      p: victimRoute.p,
      m: 'hijack',
    })
    attacker.send(forged)
    const attackerRoute = await nextRoute(agent)

    // The relay wraps the payload again, so the outer peer stays the attacker.
    expect(attackerRoute.p).not.toBe(victimRoute.p)
    expect(attackerRoute.m).toBe(forged)

    agent.close(1000, 'done')
    victim.close(1000, 'done')
    attacker.close(1000, 'done')
  })

  it('gives a replayed hello the sender peer, not the victim', async () => {
    const room = 'sid-replay-room'
    const agent = await connect(room, 'agent')
    const victim = await connect(room, 'client')
    const attacker = await connect(room, 'client')

    const hello = JSON.stringify({
      t: 'hello',
      v: PROTOCOL_VERSION,
      sid: 'shared-session-id',
      nonce: 'nonce-aaaaaaaaaaaaaaaaaaaa',
      role: 'client',
    })

    victim.send(hello)
    const victimRoute = await nextRoute(agent)
    attacker.send(hello)
    const attackerRoute = await nextRoute(agent)

    // Both frames carry the same sid, but the hub sees the real sender peer,
    // so it can keep the victim's session and drop the replayed hello.
    expect(victimRoute.m).toBe(hello)
    expect(attackerRoute.m).toBe(hello)
    expect(attackerRoute.p).not.toBe(victimRoute.p)

    agent.close(1000, 'done')
    victim.close(1000, 'done')
    attacker.close(1000, 'done')
  })

  it('closes a client that sends an oversized frame', async () => {
    const room = 'large-room'
    const agent = await connect(room, 'agent')
    const client = await connect(room, 'client')

    const closed = nextClose(client)
    client.send('x'.repeat(MAX_CLIENT_FRAME_BYTES + 1))
    await expect(closed).resolves.toBe(4009)

    agent.close(1000, 'done')
  })

  it('never forwards a frame after an oversized refusal', async () => {
    const room = 'large-gap-room'
    const agent = await connect(room, 'agent')
    const messages = collectMessages(agent)
    const grantId = 'large-gap-device'
    const client = await connectWithResponse(room, 'client', await grantFor(room, grantId))

    client.socket.send('before')
    client.socket.send('x'.repeat(MAX_CLIENT_FRAME_BYTES + 1))
    client.socket.send('after')

    await expect(client.closed).resolves.toBe(4009)
    await settle()

    // Everything queued behind the refused frame is dropped too, so the hub
    // never sees a sealed-sequence hole.
    expect(routedPayloads(messages, grantId)).toEqual(['before'])

    agent.close(1000, 'done')
  })

  it('round-trips a binary client frame as base64url', async () => {
    const room = 'binary-room'
    const agent = await connect(room, 'agent')
    const client = await connect(room, 'client')

    const bytes = new Uint8Array([0, 1, 2, 250, 251, 252])
    client.send(bytes)
    const route = await nextRoute(agent)
    expect(route.b).toBe(true)
    expect([...Buffer.from(route.m, 'base64url')]).toEqual([...bytes])

    agent.close(1000, 'done')
    client.close(1000, 'done')
  })

  it('closes clients when the agent disconnects', async () => {
    const room = 'disconnect-room'
    const agent = await connect(room, 'agent')
    const client = await connect(room, 'client')

    const closed = nextClose(client)
    agent.close(1000, 'going away')
    await expect(closed).resolves.toBe(1012)
  })

  it('rejects the 33rd client socket in a room', async () => {
    const room = 'room-cap'
    const agent = await connect(room, 'agent')
    const clients: WebSocket[] = []
    for (let index = 0; index < MAX_CLIENT_SOCKETS_PER_ROOM; index += 1) {
      clients.push(await connect(room, 'client'))
    }

    const extra = await connectWithResponse(room, 'client')
    await expect(extra.closed).resolves.toBe(CLIENT_LIMIT_CODE)

    // The room keeps working for the clients that were already admitted.
    const messages = collectMessages(agent)
    const first = clients[0]
    if (!first) throw new Error('No admitted client')
    first.send('still-here')
    await waitFor(() => (routedPeer(messages, 'still-here') ? true : undefined))

    for (const client of clients) client.close(1000, 'done')
    agent.close(1000, 'done')
  })

  it('caps concurrent clients from one cf-connecting-ip address', async () => {
    const room = 'ip-cap'
    const agent = await connect(room, 'agent')
    const headers = { 'cf-connecting-ip': '203.0.113.10' }
    const credential = await grantFor(room, 'device-same-network')
    const clients: WebSocket[] = []
    for (let index = 0; index < MAX_CLIENT_SOCKETS_PER_IP; index += 1) {
      clients.push(await connect(room, 'client', credential, headers))
    }

    const extra = await connectWithResponse(room, 'client', credential, headers)
    await expect(extra.closed).resolves.toBe(CLIENT_LIMIT_CODE)

    // A second network still joins: the cap is per address, not per room.
    const other = await connectWithResponse(room, 'client', credential, {
      'cf-connecting-ip': '198.51.100.4',
    })
    const messages = collectMessages(agent)
    other.socket.send('other-ip')
    await waitFor(() => (routedPeer(messages, 'other-ip') ? true : undefined))

    for (const client of clients) client.close(1000, 'done')
    other.socket.close(1000, 'done')
    agent.close(1000, 'done')
  })

  it('skips the per-IP cap when the request has no client address', async () => {
    const room = 'ip-unknown'
    const agent = await connect(room, 'agent')
    const messages = collectMessages(agent)
    const clients: WebSocket[] = []
    for (let index = 0; index < MAX_CLIENT_SOCKETS_PER_IP + 2; index += 1) {
      clients.push(await connect(room, 'client'))
    }

    const last = clients[clients.length - 1]
    if (!last) throw new Error('No client')
    last.send('no-ip')
    await waitFor(() => (routedPeer(messages, 'no-ip') ? true : undefined))

    for (const client of clients) client.close(1000, 'done')
    agent.close(1000, 'done')
  })

  it('closes a peer above the frame rate and keeps other peers connected', async () => {
    const room = 'frame-rate'
    const agent = await connect(room, 'agent')
    const messages = collectMessages(agent)
    const flooder = await connectWithResponse(room, 'client')
    const healthy = await connectWithResponse(room, 'client')

    for (let index = 0; index < CLIENT_FRAME_BURST * 3; index += 1) {
      flooder.socket.send('flood')
    }
    healthy.socket.send('healthy')

    await expect(flooder.closed).resolves.toBe(CLIENT_LIMIT_CODE)
    await waitFor(() => (routedPeer(messages, 'healthy') ? true : undefined))
    // The offender's buckets are deleted on close; only the healthy peer's
    // state remains, so peer churn cannot grow the map.
    await waitFor(async () => ((await peerStateCount(room)) === 1 ? true : undefined))

    healthy.socket.close(1000, 'done')
    agent.close(1000, 'done')
  })

  it('never forwards a frame after a rate refusal', async () => {
    const room = 'frame-rate-gap'
    const agent = await connect(room, 'agent')
    const messages = collectMessages(agent)
    const grantId = 'rate-gap-device'
    const client = await connectWithResponse(room, 'client', await grantFor(room, grantId))

    const sent = CLIENT_FRAME_BURST * 3
    for (let index = 0; index < sent; index += 1) client.socket.send(`frame-${index}`)

    await expect(client.closed).resolves.toBe(CLIENT_LIMIT_CODE)
    await settle()

    // The agent must see a contiguous prefix. A frame queued behind the
    // refusal must not slip through and create a sealed-sequence hole.
    const payloads = routedPayloads(messages, grantId)
    expect(payloads.length).toBeGreaterThan(0)
    expect(payloads.length).toBeLessThan(sent)
    expect(payloads).toEqual(payloads.map((_, index) => `frame-${index}`))

    agent.close(1000, 'done')
  })

  it('closes a peer above the byte rate', async () => {
    const room = 'byte-rate'
    const agent = await connect(room, 'agent')
    // Drain the hub socket so the burst does not back up its send buffer.
    collectMessages(agent)
    const client = await connectWithResponse(room, 'client')

    const payload = 'x'.repeat(64 * 1024)
    for (let index = 0; index < 24; index += 1) client.socket.send(payload)

    await expect(client.closed).resolves.toBe(CLIENT_LIMIT_CODE)
    agent.close(1000, 'done')
  })
})
