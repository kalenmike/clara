import { describe, expect, it } from 'vitest'
import type { PanelHarness, PanelHarnessPairing } from '@clara/shared-types'
import { isPairingRegistered } from './harness-pairing.ts'

function pairing(patch: Partial<PanelHarnessPairing> = {}): PanelHarnessPairing {
  return {
    id: 'pairing-1',
    kind: 'opencode',
    label: 'OpenCode',
    code: 'clara-harness1_test',
    transport: 'docker',
    wsUrl: 'ws://server:8788/ws',
    room: 'local',
    fingerprint: 'pairing-fingerprint',
    expiresAt: '2026-01-01T00:10:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...patch,
  }
}

function harness(patch: Partial<PanelHarness> = {}): PanelHarness {
  return {
    id: 'harness-1',
    harnessId: 'machine-1',
    kind: 'opencode',
    label: 'OpenCode',
    transport: 'local',
    online: false,
    isActive: true,
    credentialConfigured: true,
    createdAt: '2025-12-31T23:00:00.000Z',
    updatedAt: '2025-12-31T23:00:00.000Z',
    ...patch,
  }
}

describe('isPairingRegistered', () => {
  it('detects a harness seen after the pairing code was issued', () => {
    expect(
      isPairingRegistered(pairing(), [harness({ lastSeenAt: '2026-01-01T00:00:05.000Z' })])
    ).toBe(true)
  })

  it('detects a harness created after the pairing code was issued', () => {
    expect(
      isPairingRegistered(pairing(), [harness({ createdAt: '2026-01-01T00:00:05.000Z' })])
    ).toBe(true)
  })

  it('ignores harnesses of another kind or older connections', () => {
    expect(
      isPairingRegistered(pairing(), [
        harness({ kind: 'claude', lastSeenAt: '2026-01-01T00:00:05.000Z' }),
      ])
    ).toBe(false)
    expect(
      isPairingRegistered(pairing(), [harness({ lastSeenAt: '2025-12-31T23:59:00.000Z' })])
    ).toBe(false)
  })
})
