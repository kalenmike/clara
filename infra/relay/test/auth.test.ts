import { SELF } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { PROTOCOL_VERSION, createRelayGrant } from '@clara/shared-types'
import { forwardedProtocolHeader } from '../src/index.ts'

const AGENT_TOKEN = 'agent-test-token'
const ROOM = 'auth-room'

type Role = 'agent' | 'client'

async function grantFor(room = ROOM, id = 'device-test-1'): Promise<string> {
  const { grant } = await createRelayGrant({
    room,
    id,
    agentToken: AGENT_TOKEN,
    ttlSeconds: 600,
  })
  return grant
}

function protocols(role: Role, credential?: string): string {
  return [
    'clara.v1',
    `clara.role.${role}`,
    ...(credential ? [`clara.auth.${credential}`] : []),
  ].join(', ')
}

async function upgrade(room: string, header: string, extra: Record<string, string> = {}) {
  return SELF.fetch(`https://relay.test/room/${room}`, {
    headers: {
      Upgrade: 'websocket',
      'Sec-WebSocket-Protocol': header,
      ...extra,
    },
  })
}

describe('relay worker authentication', () => {
  it('answers the health check without credentials', async () => {
    const response = await SELF.fetch('https://relay.test/health')

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ ok: true })
  })

  it('reports the protocol and route envelope versions on the health check', async () => {
    const response = await SELF.fetch('https://relay.test/health')

    await expect(response.json()).resolves.toEqual({
      ok: true,
      protocol: PROTOCOL_VERSION,
      relay: 3,
    })
  })

  it('rejects a client without a credential', async () => {
    const response = await upgrade(ROOM, protocols('client'))

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'unauthorized' })
  })

  it('routes a verified grant to the Durable Object', async () => {
    const response = await upgrade(ROOM, protocols('client', await grantFor()))

    expect(response.status).toBe(101)
    const socket = response.webSocket
    if (!socket) throw new Error('No WebSocket upgrade')
    socket.accept()
    socket.close(1000, 'done')
  })

  it('still authenticates the hub with the agent token', async () => {
    const response = await upgrade(ROOM, protocols('agent', AGENT_TOKEN))

    expect(response.status).toBe(101)
    const socket = response.webSocket
    if (!socket) throw new Error('No WebSocket upgrade')
    socket.accept()
    socket.close(1000, 'done')
  })

  it('rejects the legacy shared client token', async () => {
    const response = await upgrade(ROOM, protocols('client', 'client-test-token'))

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'unauthorized' })
  })

  it('rejects a grant signed for another room', async () => {
    const response = await upgrade(ROOM, protocols('client', await grantFor('some-other-room')))

    expect(response.status).toBe(401)
  })

  it('rejects an expired grant', async () => {
    const now = Math.floor(Date.now() / 1000)
    const { grant } = await createRelayGrant({
      room: ROOM,
      id: 'device-expired',
      agentToken: AGENT_TOKEN,
      ttlSeconds: 60,
      nowSeconds: now - 3_600,
    })

    const response = await upgrade(ROOM, protocols('client', grant))

    expect(response.status).toBe(401)
  })

  it('accepts a grant inside the clock leeway', async () => {
    const now = Math.floor(Date.now() / 1000)
    const { grant } = await createRelayGrant({
      room: ROOM,
      id: 'device-leeway',
      agentToken: AGENT_TOKEN,
      ttlSeconds: 60,
      nowSeconds: now - 90,
    })

    const response = await upgrade(ROOM, protocols('client', grant))

    expect(response.status).toBe(101)
    response.webSocket?.accept()
    response.webSocket?.close(1000, 'done')
  })

  it('rejects a tampered signature', async () => {
    const grant = await grantFor()
    const [payload, signature] = grant.split('.')
    if (!payload || !signature) throw new Error('Unexpected grant shape')
    // Flip the first character: the trailing base64url character only carries
    // padding bits, so changing it can decode to the same signature bytes.
    const first = signature.at(0) === 'A' ? 'B' : 'A'
    const tampered = `${payload}.${first}${signature.slice(1)}`

    const response = await upgrade(ROOM, protocols('client', tampered))

    expect(response.status).toBe(401)
  })

  it('rejects a grant signed with another token', async () => {
    const { grant } = await createRelayGrant({
      room: ROOM,
      id: 'device-foreign',
      agentToken: 'not-the-agent-token',
      ttlSeconds: 600,
    })

    const response = await upgrade(ROOM, protocols('client', grant))

    expect(response.status).toBe(401)
  })

  it('rejects malformed grant values', async () => {
    for (const value of ['not-a-grant', 'abc.', '.abc', 'a.b.c', '!@#.$%^']) {
      const response = await upgrade(ROOM, protocols('client', value))
      expect(response.status).toBe(401)
    }
  })

  it('rejects a credential containing a comma cleanly', async () => {
    const response = await upgrade(
      ROOM,
      ['clara.v1', 'clara.role.client', 'clara.auth.token,with,commas'].join(', ')
    )

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'unauthorized' })
  })

  it('rejects a malformed room escape instead of failing internally', async () => {
    const response = await SELF.fetch('https://relay.test/room/%zz', {
      headers: {
        Upgrade: 'websocket',
        'Sec-WebSocket-Protocol': protocols('client', await grantFor()),
      },
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'invalid room' })
  })
})

describe('forwarded subprotocol header', () => {
  it('drops a header that only carries Clara values', () => {
    expect(
      forwardedProtocolHeader(
        ['clara.v1', 'clara.role.client', 'clara.auth.payload.signature'].join(', ')
      )
    ).toBeNull()
  })

  it('removes the credential and keeps a non-Clara protocol', () => {
    expect(
      forwardedProtocolHeader(
        ['clara.v1', 'clara.role.agent', `clara.auth.${AGENT_TOKEN}`, 'app.v2'].join(', ')
      )
    ).toBe('clara.v1, clara.role.agent, app.v2')
  })

  it('leaves a request without Clara values untouched', () => {
    expect(forwardedProtocolHeader('app.v2')).toBe('app.v2')
    expect(forwardedProtocolHeader(null)).toBeNull()
  })
})
