import { describe, expect, it } from 'vitest'
import {
  PROTOCOL_VERSION,
  PROTOCOL_VERSION_V4,
  decodePairingCode,
  encodePairingCode,
  isClientHelloFrameV4,
  isHelloFrameV4,
  isHubHelloFrameV4,
  isRouteFrame,
  isRouteFrameV3,
  type AdapterEnrolledState,
  type ClaraAction,
  type ClaraState,
  type PairingPayload,
} from '../src/index.ts'

const POINT = pointBytes()
const MAC = base64Url(new Uint8Array(32).fill(3))

describe('v4 client hello', () => {
  it('accepts a device hello', () => {
    expect(
      isClientHelloFrameV4({
        t: 'hello',
        v: PROTOCOL_VERSION_V4,
        sid: 'sid-1',
        nonce: 'nonce-1',
        role: 'client',
        eph: POINT,
        deviceId: 'device-1',
      })
    ).toBe(true)
  })

  it('accepts enrollment and adapter identities', () => {
    expect(
      isClientHelloFrameV4({
        t: 'hello',
        v: PROTOCOL_VERSION_V4,
        sid: 'sid-1',
        nonce: 'nonce-1',
        role: 'client',
        eph: POINT,
        enrollId: 'enroll-1',
        adapter: true,
      })
    ).toBe(true)
    expect(
      isClientHelloFrameV4({
        t: 'hello',
        v: PROTOCOL_VERSION_V4,
        sid: 'sid-1',
        nonce: 'nonce-1',
        role: 'client',
        eph: POINT,
        adapter: true,
        adapterId: 'adapter-1',
      })
    ).toBe(true)
    expect(
      isClientHelloFrameV4({
        t: 'hello',
        v: PROTOCOL_VERSION_V4,
        sid: 'sid-1',
        nonce: 'nonce-1',
        role: 'client',
        eph: POINT,
        enrollId: 'enroll-1',
        adapter: true,
        adapterId: 'adapter-1',
      })
    ).toBe(true)
  })

  it('rejects missing or short cryptographic fields', () => {
    const base = {
      t: 'hello',
      v: PROTOCOL_VERSION_V4,
      sid: 'sid-1',
      nonce: 'nonce-1',
      role: 'client',
      deviceId: 'device-1',
    }
    expect(isClientHelloFrameV4(base)).toBe(false)
    expect(isClientHelloFrameV4({ ...base, eph: base64Url(new Uint8Array(64)) })).toBe(false)
    expect(isClientHelloFrameV4({ ...base, eph: 'not base64url!' })).toBe(false)
    expect(isClientHelloFrameV4({ ...base, eph: POINT, nonce: '' })).toBe(false)
    expect(isClientHelloFrameV4({ ...base, eph: POINT, sid: '' })).toBe(false)
    expect(isClientHelloFrameV4({ ...base, eph: POINT, sid: 'sid|other' })).toBe(false)
  })

  it('rejects ambiguous identities', () => {
    const base = {
      t: 'hello',
      v: PROTOCOL_VERSION_V4,
      sid: 'sid-1',
      nonce: 'nonce-1',
      role: 'client',
      eph: POINT,
    }
    expect(isClientHelloFrameV4(base)).toBe(false)
    expect(isClientHelloFrameV4({ ...base, deviceId: 'device-1', enrollId: 'enroll-1' })).toBe(
      false
    )
    expect(
      isClientHelloFrameV4({ ...base, deviceId: 'device-1', adapter: true, adapterId: 'adapter-1' })
    ).toBe(false)
    expect(isClientHelloFrameV4({ ...base, adapterId: 'adapter-1' })).toBe(false)
    expect(isClientHelloFrameV4({ ...base, deviceId: 'device-1', adapter: true })).toBe(false)
    expect(isClientHelloFrameV4({ ...base, enrollId: 'enroll-1', adapterId: 'adapter-1' })).toBe(
      false
    )
  })

  it('rejects v3 and unknown versions', () => {
    expect(
      isClientHelloFrameV4({
        t: 'hello',
        v: 3,
        sid: 'sid-1',
        nonce: 'nonce-1',
        role: 'client',
        eph: POINT,
        deviceId: 'device-1',
      })
    ).toBe(false)
  })

  it('rejects an oversized session id or nonce', () => {
    const base = {
      t: 'hello',
      v: PROTOCOL_VERSION_V4,
      sid: 'sid-1',
      nonce: 'nonce-1',
      role: 'client',
      eph: POINT,
      deviceId: 'device-1',
    }
    expect(isClientHelloFrameV4({ ...base, sid: 's'.repeat(129) })).toBe(false)
    expect(isClientHelloFrameV4({ ...base, nonce: 'n'.repeat(129) })).toBe(false)
  })
})

describe('v4 hub hello', () => {
  const base = {
    t: 'hello',
    v: PROTOCOL_VERSION_V4,
    sid: 'sid-1',
    nonce: 'nonce-2',
    role: 'agent',
    eph: POINT,
    mac: MAC,
  }

  it('accepts a hub hello with an ephemeral point and MAC', () => {
    expect(isHubHelloFrameV4(base)).toBe(true)
    expect(isHelloFrameV4(base)).toBe(true)
  })

  it('rejects a missing or short MAC', () => {
    expect(isHubHelloFrameV4({ ...base, mac: undefined })).toBe(false)
    expect(isHubHelloFrameV4({ ...base, mac: base64Url(new Uint8Array(31)) })).toBe(false)
  })

  it('rejects a client-role frame as a hub hello', () => {
    expect(isHubHelloFrameV4({ ...base, role: 'client' })).toBe(false)
  })
})

describe('route envelope v3', () => {
  const route = {
    t: 'route',
    v: PROTOCOL_VERSION,
    p: 'peer-1',
    i: 'device-1',
    m: 'frame',
  }

  it('accepts an envelope with a verified grant id', () => {
    expect(isRouteFrameV3(route)).toBe(true)
    expect(isRouteFrameV3({ ...route, b: true })).toBe(true)
  })

  it('rejects a missing, empty, or oversized grant id', () => {
    const withoutId = { t: route.t, v: route.v, p: route.p, m: route.m }
    expect(isRouteFrameV3(withoutId)).toBe(false)
    expect(isRouteFrameV3({ ...route, i: '' })).toBe(false)
    expect(isRouteFrameV3({ ...route, i: 'a'.repeat(129) })).toBe(false)
  })

  it('keeps the v2 route guard working without a grant id', () => {
    const v2 = { t: route.t, v: route.v, p: route.p, m: route.m }
    expect(isRouteFrame(v2)).toBe(true)
    expect(isRouteFrameV3(v2)).toBe(false)
  })
})

describe('v4 pairing and ready contract', () => {
  const base: PairingPayload = {
    v: PROTOCOL_VERSION,
    wsUrl: 'wss://relay.clara.example',
    room: 'room-1',
    clientToken: 'client-token',
    enrollId: 'enroll-id',
    enrollToken: 'enroll-token',
    fingerprint: 'fingerprint',
    expiresAt: 1_800_000_000_000,
  }

  it('carries an optional enrollment grant', () => {
    const withGrant = { ...base, grant: 'encoded.signature' }
    expect(decodePairingCode(encodePairingCode(withGrant))).toEqual(withGrant)
    expect(decodePairingCode(encodePairingCode(base))).toEqual(base)
  })

  it('carries a relay grant on the sealed ready action', () => {
    const ready: ClaraAction = {
      type: 'ready',
      agent: { version: 'test', protocol: PROTOCOL_VERSION },
      relayGrant: { grant: 'encoded.signature', expiresAt: 1_900_000_000_000 },
    }
    expect(ready.type).toBe('ready')
    if (ready.type === 'ready') {
      expect(ready.relayGrant).toEqual({
        grant: 'encoded.signature',
        expiresAt: 1_900_000_000_000,
      })
    }
  })

  it('carries the first relay grant on the enrollment responses', () => {
    const grant = { grant: 'encoded.signature', expiresAt: 1_900_000_000_000 }
    const device: ClaraState = {
      type: 'device.enrolled',
      deviceId: 'device-1',
      fingerprint: 'fingerprint',
      label: 'Desk',
      relayGrant: grant,
    }
    const adapter: AdapterEnrolledState = {
      type: 'adapter.enrolled',
      connectionId: 'connection-1',
      harnessId: 'harness-1',
      label: 'Laptop',
      reconnected: false,
      relayGrant: grant,
    }
    expect(device).toMatchObject({ relayGrant: grant })
    expect(adapter).toMatchObject({ relayGrant: grant })
  })
})

function pointBytes(): string {
  const bytes = new Uint8Array(65)
  bytes[0] = 0x04
  bytes.fill(1, 1)
  return base64Url(bytes)
}

function base64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
