import { describe, expect, it } from 'vitest'
import {
  PAIRING_CODE_PREFIX,
  PROTOCOL_VERSION,
  buildPairingUrl,
  decodePairingCode,
  encodePairingCode,
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
  psk: 'psk-value',
  fingerprint: 'fingerprint',
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
})

describe('frame guards', () => {
  it('recognizes hello and sealed frames', () => {
    expect(isHelloFrame({ t: 'hello', v: 1, sid: 'a', nonce: 'b', role: 'client' })).toBe(true)
    expect(isSealedFrame({ t: 'sealed', v: 1, sid: 'a', seq: 0, iv: 'iv', ct: 'ct' })).toBe(true)
    expect(isSealedFrame({ t: 'sealed', v: 2, sid: 'a', seq: 0, iv: 'iv', ct: 'ct' })).toBe(false)
  })
})
