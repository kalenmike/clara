import { describe, expect, it } from 'vitest'
import type { PanelHarness } from '@clara/shared-types'
import { findHarnessPairingConnection, isPairingRegistered } from './harness-pairing.ts'

function harness(overrides: Partial<PanelHarness> = {}): PanelHarness {
  return {
    id: 'harness-1',
    harnessId: 'native-1',
    kind: 'opencode',
    label: 'OpenCode',
    transport: 'relay',
    online: true,
    credentialConfigured: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('findHarnessPairingConnection', () => {
  it('matches a harness seen after the code was issued', () => {
    const pairing = { kind: 'opencode', createdAt: '2026-01-01T00:00:00.000Z' }
    expect(
      findHarnessPairingConnection(pairing, [harness({ lastSeenAt: '2026-01-01T00:00:01.000Z' })])
        ?.id
    ).toBe('harness-1')
  })

  it('ignores an older connection and a different kind', () => {
    const pairing = { kind: 'opencode', createdAt: '2026-01-02T00:00:00.000Z' }
    expect(
      findHarnessPairingConnection(pairing, [harness({ lastSeenAt: '2026-01-01T00:00:00.000Z' })])
    ).toBeUndefined()
    expect(isPairingRegistered(pairing, [harness({ kind: 'claude' })])).toBe(false)
  })
})
