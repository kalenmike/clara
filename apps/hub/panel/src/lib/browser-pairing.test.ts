import { describe, expect, it } from 'vitest'
import type { PanelClientInfo, PanelDeviceInfo } from '@clara/shared-types'
import { findBrowserPairingConnection } from './browser-pairing.ts'

const ISSUED_AT = Date.parse('2026-01-01T00:00:00.000Z')

function client(patch: Partial<PanelClientInfo> = {}): PanelClientInfo {
  return {
    sid: 'session-1',
    transport: 'local',
    kind: 'device',
    deviceId: 'device-1',
    deviceLabel: 'Desk',
    connectedAt: '2026-01-01T00:00:05.000Z',
    lastSeenAt: '2026-01-01T00:00:05.000Z',
    idleMs: 0,
    requests: 0,
    holdPhone: false,
    ...patch,
  }
}

function device(patch: Partial<PanelDeviceInfo> = {}): PanelDeviceInfo {
  return {
    id: 'device-1',
    label: 'Desk',
    fingerprint: 'fingerprint',
    createdAt: '2026-01-01T00:00:05.000Z',
    liveSessions: 1,
    ...patch,
  }
}

describe('findBrowserPairingConnection', () => {
  it('detects a live device session created after the code was issued', () => {
    const connected = findBrowserPairingConnection(ISSUED_AT, 'local', {
      clients: [client()],
      devices: [device()],
    })

    expect(connected).toMatchObject({
      client: { sid: 'session-1' },
      device: { id: 'device-1' },
      label: 'Desk',
    })
  })

  it('prefers the device alias for the connected label', () => {
    const connected = findBrowserPairingConnection(ISSUED_AT, 'local', {
      clients: [client({ deviceLabel: undefined })],
      devices: [device({ alias: 'Kitchen tablet' })],
    })

    expect(connected?.label).toBe('Kitchen tablet')
  })

  it('ignores enrollment sessions', () => {
    expect(
      findBrowserPairingConnection(ISSUED_AT, 'local', {
        clients: [client({ kind: 'enroll', deviceId: undefined })],
        devices: [],
      })
    ).toBeUndefined()
  })

  it('ignores sessions that connected before the code was issued', () => {
    expect(
      findBrowserPairingConnection(ISSUED_AT, 'local', {
        clients: [client({ connectedAt: '2025-12-31T23:59:00.000Z' })],
        devices: [],
      })
    ).toBeUndefined()
  })
})

describe('findBrowserPairingConnection device fallback', () => {
  it('detects a newly enrolled device without a live session', () => {
    const connected = findBrowserPairingConnection(ISSUED_AT, 'local', {
      clients: [],
      devices: [device()],
    })

    expect(connected).toMatchObject({ device: { id: 'device-1' }, label: 'Desk' })
  })

  it('detects an existing device that reconnects after the code was issued', () => {
    const connected = findBrowserPairingConnection(ISSUED_AT, 'relay', {
      clients: [
        client({
          connectedAt: '2026-01-01T00:00:10.000Z',
          transport: 'relay',
          deviceLabel: undefined,
        }),
      ],
      devices: [
        device({
          createdAt: '2025-12-01T00:00:00.000Z',
          lastSeenAt: '2026-01-01T00:00:10.000Z',
          transport: 'relay',
        }),
      ],
    })

    expect(connected).toMatchObject({ device: { id: 'device-1' }, label: 'Desk' })
  })

  it('ignores an existing device that was only seen after the code was issued', () => {
    expect(
      findBrowserPairingConnection(ISSUED_AT, 'relay', {
        clients: [],
        devices: [
          device({
            createdAt: '2025-12-01T00:00:00.000Z',
            lastSeenAt: '2026-01-01T00:00:10.000Z',
            transport: 'relay',
          }),
        ],
      })
    ).toBeUndefined()
  })

  it('ignores another transport and revoked devices', () => {
    expect(
      findBrowserPairingConnection(ISSUED_AT, 'local', {
        clients: [client({ transport: 'relay' })],
        devices: [device({ transport: 'relay' })],
      })
    ).toBeUndefined()

    expect(
      findBrowserPairingConnection(ISSUED_AT, 'local', {
        clients: [],
        devices: [device({ revokedAt: '2026-01-01T00:00:06.000Z' })],
      })
    ).toBeUndefined()
  })

  it('ignores an invalid issue time', () => {
    expect(
      findBrowserPairingConnection(Number.NaN, 'local', {
        clients: [client()],
        devices: [device()],
      })
    ).toBeUndefined()
  })
})
