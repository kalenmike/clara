import { SELF } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'

const AGENT_TOKEN = 'agent-test-token'
const CLIENT_TOKEN = 'client-test-token'

type Role = 'agent' | 'client'

async function connect(room: string, role: Role, token = roleToken(role)): Promise<WebSocket> {
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

  it('routes client frames to the agent and broadcasts agent frames', async () => {
    const room = 'routing-room'
    const agent = await connect(room, 'agent')
    const first = await connect(room, 'client')
    const second = await connect(room, 'client')

    const agentMessage = nextMessage(agent)
    first.send('from-first')
    await expect(agentMessage).resolves.toBe('from-first')

    const agentMessageAgain = nextMessage(agent)
    second.send('from-second')
    await expect(agentMessageAgain).resolves.toBe('from-second')

    const firstBroadcast = nextMessage(first)
    const secondBroadcast = nextMessage(second)
    agent.send('to-everyone')
    await expect(firstBroadcast).resolves.toBe('to-everyone')
    await expect(secondBroadcast).resolves.toBe('to-everyone')

    agent.close(1000, 'done')
    first.close(1000, 'done')
    second.close(1000, 'done')
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
