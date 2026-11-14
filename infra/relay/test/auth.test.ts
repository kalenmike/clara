import { SELF } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { PROTOCOL_VERSION } from '@clara/shared-types'
import { forwardedProtocolHeader } from '../src/index.ts'

const AGENT_TOKEN = 'agent-test-token'
const CLIENT_TOKEN = 'client-test-token'

type Role = 'agent' | 'client'

function roleToken(role: Role): string {
  return role === 'agent' ? AGENT_TOKEN : CLIENT_TOKEN
}

function protocols(role: Role, token?: string): string {
  return ['clara.v1', `clara.role.${role}`, ...(token ? [`clara.auth.${token}`] : [])].join(', ')
}

async function upgrade(room: string, header: string): Promise<Response> {
  return SELF.fetch(`https://relay.test/room/${room}`, {
    headers: {
      Upgrade: 'websocket',
      'Sec-WebSocket-Protocol': header,
    },
  })
}

describe('relay worker authentication', () => {
  it('answers the health check without credentials', async () => {
    const response = await SELF.fetch('https://relay.test/health')

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ ok: true })
  })

  it('reports the protocol and relay versions on the health check', async () => {
    const response = await SELF.fetch('https://relay.test/health')

    await expect(response.json()).resolves.toEqual({
      ok: true,
      protocol: PROTOCOL_VERSION,
      relay: 2,
    })
  })

  it('rejects a request without a token', async () => {
    const response = await upgrade('auth-missing-token', protocols('client'))

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'unauthorized' })
  })

  it('rejects a token of the wrong length', async () => {
    const short = await upgrade('auth-short-token', protocols('client', 'short'))
    const long = await upgrade('auth-long-token', protocols('client', `${CLIENT_TOKEN}x`))

    expect(short.status).toBe(401)
    expect(long.status).toBe(401)
  })

  it('routes a correct token to the Durable Object', async () => {
    const response = await upgrade('auth-valid-token', protocols('agent', AGENT_TOKEN))

    expect(response.status).toBe(101)
    const socket = response.webSocket
    if (!socket) throw new Error('No WebSocket upgrade')
    socket.accept()
    socket.close(1000, 'done')
  })

  it('rejects a malformed room escape instead of failing internally', async () => {
    const response = await SELF.fetch('https://relay.test/room/%zz', {
      headers: {
        Upgrade: 'websocket',
        'Sec-WebSocket-Protocol': protocols('client', roleToken('client')),
      },
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'invalid room' })
  })

  it('rejects a token containing a comma cleanly', async () => {
    const response = await upgrade(
      'auth-comma-token',
      ['clara.v1', 'clara.role.client', 'clara.auth.token,with,commas'].join(', ')
    )

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'unauthorized' })
  })
})

describe('forwarded subprotocol header', () => {
  it('drops a header that only carries Clara values', () => {
    expect(
      forwardedProtocolHeader(
        ['clara.v1', 'clara.role.client', `clara.auth.${CLIENT_TOKEN}`].join(', ')
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
