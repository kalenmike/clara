import { SELF } from 'cloudflare:test'
import { isRouteFrame, PROTOCOL_VERSION, type RouteFrame } from '@clara/shared-types'
import { describe, expect, it } from 'vitest'

const AGENT_TOKEN = 'agent-test-token'
const CLIENT_TOKEN = 'client-test-token'
const MAX_CLIENT_FRAME_BYTES = 128 * 1024

type Role = 'agent' | 'client'

async function connectWithResponse(
  room: string,
  role: Role,
  token = roleToken(role)
): Promise<{ socket: WebSocket; response: Response }> {
  const response = await SELF.fetch(`https://relay.test/room/${room}`, {
    headers: {
      Upgrade: 'websocket',
      'Sec-WebSocket-Protocol': ['clara.v1', `clara.role.${role}`, `clara.auth.${token}`].join(
        ', '
      ),
    },
  })
  expect(response.status).toBe(101)
  const socket = response.webSocket
  if (!socket) throw new Error('No WebSocket upgrade')
  socket.accept()
  return { socket, response }
}

async function connect(room: string, role: Role, token = roleToken(role)): Promise<WebSocket> {
  const { socket } = await connectWithResponse(room, role, token)
  return socket
}

function roleToken(role: Role): string {
  return role === 'agent' ? AGENT_TOKEN : CLIENT_TOKEN
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

async function nextRoute(socket: WebSocket): Promise<RouteFrame> {
  const parsed: unknown = JSON.parse(await nextMessage(socket))
  if (!isRouteFrame(parsed)) throw new Error('Expected a route frame')
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
    expect(agent.response.headers.get('x-clara-relay-version')).toBe('2')
    agent.socket.close(1000, 'done')
  })

  it('tags client frames with a per-socket peer and broadcasts hub frames verbatim', async () => {
    const room = 'routing-room'
    const agent = await connect(room, 'agent')
    const first = await connect(room, 'client')
    const second = await connect(room, 'client')

    first.send('from-first')
    const firstRoute = await nextRoute(agent)
    expect(firstRoute).toMatchObject({ t: 'route', v: PROTOCOL_VERSION, m: 'from-first' })
    expect(firstRoute.p).toMatch(/^[A-Za-z0-9_-]{22}$/)

    second.send('from-second')
    const secondRoute = await nextRoute(agent)
    expect(secondRoute.m).toBe('from-second')
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
})
