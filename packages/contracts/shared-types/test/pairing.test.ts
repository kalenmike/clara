import { describe, expect, it } from 'vitest'
import {
  PAIRING_CODE_PREFIX,
  PAIRING_LINK_MAX_LENGTH,
  PROTOCOL_VERSION,
  buildPairingUrl,
  createRelayGrant,
  decodePairingCode,
  encodePairingCode,
  parsePairingInput,
  type PairingPayload,
} from '../src/index.ts'

const payload: PairingPayload = {
  v: PROTOCOL_VERSION,
  wsUrl: 'wss://relay.clara.example',
  room: 'room-1',
  grant: 'encoded.signature',
  enrollId: 'enroll-id',
  enrollToken: 'enroll-token',
  fingerprint: 'fingerprint',
  expiresAt: 1_800_000_000_000,
}

const localPayload: PairingPayload = {
  ...payload,
  wsUrl: 'ws://127.0.0.1:8788/ws',
  room: 'local',
  grant: undefined,
}

describe('pairing', () => {
  it('round-trips a pairing code', () => {
    const code = encodePairingCode(payload)
    expect(code.startsWith(PAIRING_CODE_PREFIX)).toBe(false)
    expect(decodePairingCode(code)).toEqual(payload)
  })

  it('accepts a prefixed code and a URL fragment', () => {
    const code = encodePairingCode(payload)
    expect(parsePairingInput(`${PAIRING_CODE_PREFIX}${code}`)).toEqual(payload)
    expect(parsePairingInput(buildPairingUrl('https://clara.example', payload))).toEqual(payload)
  })

  it('requires a grant for a relay payload and allows a local one without it', () => {
    expect(decodePairingCode(encodePairingCode({ ...payload, grant: undefined }))).toBeNull()
    expect(decodePairingCode(encodePairingCode(localPayload))).toEqual(localPayload)
  })

  it('rejects malformed payloads', () => {
    expect(parsePairingInput('not-a-code')).toBeNull()
    expect(parsePairingInput('https://clara.example/#pair=bad')).toBeNull()
  })

  it('rejects the old shared-key payload shape', () => {
    const legacy = {
      v: 1,
      wsUrl: 'wss://relay.clara.example',
      room: 'room-1',
      psk: 'psk-value',
      fingerprint: 'fingerprint',
    }
    expect(decodePairingCode(encodePairingCode(legacy as unknown as PairingPayload))).toBeNull()
  })

  it('keeps a relay link inside the QR size budget', async () => {
    // Field lengths match what the hub issues: a 22-character base64url room
    // and enrollment id, a 43-character enrollment token and device key, a
    // signed 204-character grant, and the advertised relay URL.
    const room = 'r'.repeat(22)
    const grant = await createRelayGrant({
      room,
      id: 'e'.repeat(22),
      agentToken: 'a'.repeat(43),
      ttlSeconds: 600,
      nowSeconds: 1_800_000_000,
    })
    const relayPayload: PairingPayload = {
      v: PROTOCOL_VERSION,
      wsUrl: `wss://clara-relay.example.workers.dev/room/${room}`,
      room,
      grant: grant.grant,
      enrollId: 'e'.repeat(22),
      enrollToken: 't'.repeat(43),
      fingerprint: `sha256:${'f'.repeat(43)}`,
      expiresAt: 1_800_000_600_000,
    }

    const link = buildPairingUrl('https://clara.example', relayPayload)
    expect(link.length).toBeLessThanOrEqual(PAIRING_LINK_MAX_LENGTH)
  })
})
