import { afterEach, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import { WebSocket, WebSocketServer } from 'ws'
import {
  bytesToBase64Url,
  deriveV4SessionKeys,
  generateEphemeralKeyPair,
  generateKey,
  open,
  randomBytes,
  seal,
  utf8,
  type V4SessionKeys,
} from '@clara/crypto'
import { PROTOCOL_VERSION, RELAY_AUTH_PREFIX, type RelayGrantState } from '@clara/shared-types'
import { REINSTALL_GRANT_MESSAGE } from '../src/config'
import { enrollAdapter, type EnrollmentInput } from '../src/enroll'

type EnrollmentHub = {
  wsUrl: string
  protocols: () => Array<string | undefined>
  enrollments: () => Array<Record<string, unknown>>
  close: () => Promise<void>
}

const hubs: Array<{ close: () => Promise<void> }> = []

afterEach(async () => {
  await Promise.all(hubs.splice(0).map((hub) => hub.close()))
})

const ENROLL_ID = 'enroll-1'
const ENROLL_TOKEN = generateKey()
const ADAPTER_ID = 'adapter-1'
const ADAPTER_KEY = generateKey()
const RELAY_GRANT: RelayGrantState = {
  grant: 'adapter-grant',
  expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1_000,
}

async function startHub(): Promise<EnrollmentHub> {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 })
  await new Promise<void>((resolve) => server.once('listening', resolve))
  const address = server.address()
  if (typeof address === 'string' || !address) throw new Error('The test hub did not bind')

  const protocols: Array<string | undefined> = []
  const enrollments: Array<Record<string, unknown>> = []
  const sockets = new Set<WebSocket>()

  server.on('connection', (socket, request) => {
    sockets.add(socket)
    protocols.push(request.headers['sec-websocket-protocol'])
    let keys: V4SessionKeys | undefined
    socket.on('message', (data) => {
      void handleFrame(data.toString()).catch(() => {})
    })

    async function handleFrame(text: string): Promise<void> {
      const frame = JSON.parse(text) as {
        t?: string
        sid?: string
        nonce?: string
        eph?: string
        seq?: number
        iv?: string
        ct?: string
      }
      if (frame.t === 'hello' && frame.sid && frame.nonce && frame.eph) {
        const agentNonce = bytesToBase64Url(randomBytes(16))
        const ephemeral = await generateEphemeralKeyPair()
        const material = await deriveV4SessionKeys({
          staticKey: ENROLL_TOKEN,
          sid: frame.sid,
          nonceC: frame.nonce,
          nonceS: agentNonce,
          ephC: frame.eph,
          ephS: ephemeral.publicKey,
          privateKey: ephemeral.privateKey,
          peerPublicKey: frame.eph,
        })
        keys = material.keys
        socket.send(
          JSON.stringify({
            t: 'hello',
            v: PROTOCOL_VERSION,
            sid: frame.sid,
            nonce: agentNonce,
            role: 'agent',
            eph: ephemeral.publicKey,
            mac: material.mac,
          })
        )
        return
      }
      if (
        frame.t !== 'sealed' ||
        !frame.sid ||
        frame.seq === undefined ||
        frame.iv === undefined ||
        frame.ct === undefined ||
        !keys
      ) {
        return
      }
      const plaintext = await open(
        keys.c2s,
        { sid: frame.sid, direction: 'c2s', seq: frame.seq },
        { iv: frame.iv, ct: frame.ct }
      )
      const payload = JSON.parse(new TextDecoder().decode(plaintext)) as Record<string, unknown>
      if (payload.type !== 'adapter.enroll') return
      enrollments.push(payload)
      const box = await seal(
        keys.s2c,
        { sid: frame.sid, direction: 's2c', seq: 0 },
        utf8(
          JSON.stringify({
            type: 'adapter.enrolled',
            connectionId: 'connection-1',
            harnessId: payload.harnessId,
            label: payload.label,
            reconnected: false,
            relayGrant: RELAY_GRANT,
          })
        )
      )
      socket.send(
        JSON.stringify({
          t: 'sealed',
          v: PROTOCOL_VERSION,
          sid: frame.sid,
          seq: 0,
          iv: box.iv,
          ct: box.ct,
        })
      )
    }
  })

  const hub: EnrollmentHub = {
    wsUrl: `ws://127.0.0.1:${address.port}`,
    protocols: () => protocols.slice(),
    enrollments: () => enrollments.slice(),
    close: async () => {
      for (const socket of sockets) socket.terminate()
      sockets.clear()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
  hubs.push(hub)
  return hub
}

function baseInput(wsUrl: string): EnrollmentInput {
  return {
    wsUrl,
    grant: 'enroll-grant',
    enrollId: ENROLL_ID,
    enrollToken: ENROLL_TOKEN,
    harnessId: 'harness-1',
    kind: 'opencode',
    label: 'OpenCode',
    adapterId: ADAPTER_ID,
    key: ADAPTER_KEY,
    adapterVersion: '0.1.0',
    capabilities: { sessions: { list: true } },
    timeoutMs: 5_000,
  }
}

describe('enrollAdapter', () => {
  it('enrolls with the one-time grant and returns the adapter grant', async () => {
    const hub = await startHub()
    const enrolled = await enrollAdapter(baseInput(hub.wsUrl))

    expect(enrolled.connectionId).toBe('connection-1')
    expect(enrolled.relayGrant).toEqual(RELAY_GRANT)

    const offered = hub.protocols()[0]?.split(',') ?? []
    expect(offered).toEqual(['clara.v1', 'clara.role.client', `${RELAY_AUTH_PREFIX}enroll-grant`])
    expect(hub.enrollments()).toHaveLength(1)
    expect(hub.enrollments()[0]).toMatchObject({
      type: 'adapter.enroll',
      harnessId: 'harness-1',
      credentialId: ADAPTER_ID,
      kind: 'opencode',
    })
  })

  it('fails with the reinstall message when the pairing code has no grant', async () => {
    const hub = await startHub()
    await expect(
      enrollAdapter({ ...baseInput('wss://relay.example/room'), grant: undefined })
    ).rejects.toThrow(REINSTALL_GRANT_MESSAGE)
    expect(hub.protocols()).toHaveLength(0)
  })

  it('fails with the reinstall message when the relay rejects the grant', async () => {
    const hub = await startRejectingHub()
    await expect(enrollAdapter(baseInput(hub.wsUrl))).rejects.toThrow(REINSTALL_GRANT_MESSAGE)
  })
})

async function startRejectingHub(): Promise<{ wsUrl: string; close: () => Promise<void> }> {
  const server: Server = createServer((_request, response) => {
    response.statusCode = 404
    response.end()
  })
  server.on('upgrade', (_request, socket) => {
    socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n')
    socket.destroy()
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (typeof address === 'string' || !address) throw new Error('The rejecting hub did not bind')
  const entry = {
    wsUrl: `ws://127.0.0.1:${address.port}`,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
  hubs.push(entry)
  return entry
}
