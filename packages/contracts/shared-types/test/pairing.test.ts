import { describe, expect, it } from 'vitest'
import {
  PAIRING_CODE_PREFIX,
  PROTOCOL_VERSION,
  buildPairingUrl,
  decodePairingCode,
  encodePairingCode,
  isErrorFrame,
  isHelloFrame,
  isSealedFrame,
  parsePairingInput,
  type PairingPayload,
} from '../src/index.ts'

const payload: PairingPayload = {
  v: PROTOCOL_VERSION,
  wsUrl: 'wss://relay.clara.example',
  room: 'room-1',
  clientToken: 'client-token',
  enrollId: 'enroll-id',
  enrollToken: 'enroll-token',
  fingerprint: 'fingerprint',
  expiresAt: 1_800_000_000_000,
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

  it('rejects malformed payloads', () => {
    expect(parsePairingInput('not-a-code')).toBeNull()
    expect(parsePairingInput('https://clara.example/#pair=bad')).toBeNull()
  })

  it('rejects the old shared-key payload shape', () => {
    const legacy = {
      v: 1,
      wsUrl: 'wss://relay.clara.example',
      room: 'room-1',
      clientToken: 'client-token',
      psk: 'psk-value',
      fingerprint: 'fingerprint',
    }
    expect(decodePairingCode(encodePairingCode(legacy as unknown as PairingPayload))).toBeNull()
  })
})

describe('frame guards', () => {
  it('recognizes v2 hello, sealed, and error frames', () => {
    expect(
      isHelloFrame({
        t: 'hello',
        v: PROTOCOL_VERSION,
        sid: 'a',
        nonce: 'b',
        role: 'client',
        deviceId: 'device-1',
      })
    ).toBe(true)
    expect(
      isSealedFrame({ t: 'sealed', v: PROTOCOL_VERSION, sid: 'a', seq: 0, iv: 'iv', ct: 'ct' })
    ).toBe(true)
    expect(
      isErrorFrame({
        t: 'error',
        v: PROTOCOL_VERSION,
        sid: 'a',
        code: 'unknown_device',
        message: 'Unknown device',
      })
    ).toBe(true)
  })

  it('rejects v1 frames', () => {
    expect(isHelloFrame({ t: 'hello', v: 1, sid: 'a', nonce: 'b', role: 'client' })).toBe(false)
    expect(isSealedFrame({ t: 'sealed', v: 1, sid: 'a', seq: 0, iv: 'iv', ct: 'ct' })).toBe(false)
  })
})
