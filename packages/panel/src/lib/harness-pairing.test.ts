import { describe, expect, it } from 'vitest'
import type { PanelHarness } from '@clara/shared-types'
import {
  defaultHarnessTarget,
  directHarnessTransport,
  findHarnessPairingConnection,
  isPairingRegistered,
  resolveHarnessTransport,
} from './harness-pairing.ts'

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

describe('resolveHarnessTransport', () => {
  it('sends remote harnesses through the relay', () => {
    expect(
      resolveHarnessTransport({
        machine: 'remote',
        target: 'host',
        containerized: false,
        defaultTransport: 'local',
      })
    ).toBe('relay')
  })

  it('uses the Docker network only for a containerized hub on a local client', () => {
    expect(
      resolveHarnessTransport({
        machine: 'local',
        target: 'container',
        containerized: true,
        defaultTransport: 'local',
      })
    ).toBe('docker')
    expect(
      resolveHarnessTransport({
        machine: 'local',
        target: 'container',
        containerized: false,
        defaultTransport: 'local',
      })
    ).toBe('relay')
  })

  it('keeps a relay-connected client on the relay for a local host', () => {
    expect(
      resolveHarnessTransport({
        machine: 'local',
        target: 'host',
        containerized: true,
        defaultTransport: 'relay',
      })
    ).toBe('relay')
  })

  it('uses a direct address for host and container targets', () => {
    expect(directHarnessTransport({ target: 'host', containerized: true })).toBe('local')
    expect(directHarnessTransport({ target: 'container', containerized: true })).toBe('docker')
    expect(directHarnessTransport({ target: 'container', containerized: false })).toBe('local')
  })

  it('starts a local target on the hub shape', () => {
    expect(defaultHarnessTarget(true)).toBe('container')
    expect(defaultHarnessTarget(false)).toBe('host')
  })
})
