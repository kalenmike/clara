import { describe, expect, it } from 'vitest'
import type { PanelHarness } from '@clara/shared-types'
import {
  defaultHarnessConnectionMode,
  defaultHarnessTarget,
  directHarnessTransport,
  findHarnessPairingConnection,
  harnessNeedsAddress,
  isLoopbackSocketUrl,
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

  it('uses the Docker network for a local container whenever one is available', () => {
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
    ).toBe('docker')
  })

  it('keeps a relay-connected client on the relay for a local container', () => {
    expect(
      resolveHarnessTransport({
        machine: 'local',
        target: 'container',
        containerized: false,
        defaultTransport: 'relay',
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
    expect(directHarnessTransport({ target: 'container', containerized: false })).toBe('docker')
  })

  it('starts a local target on the hub shape', () => {
    expect(defaultHarnessTarget(true)).toBe('container')
    expect(defaultHarnessTarget(false)).toBe('host')
  })
})

describe('harnessNeedsAddress', () => {
  const base = {
    machine: 'local' as const,
    target: 'host' as const,
    containerized: false,
    relayUsable: false,
    direct: false,
  }

  it('does not need an address for a local host or a relay pairing', () => {
    expect(harnessNeedsAddress(base)).toBe(false)
    expect(harnessNeedsAddress({ ...base, machine: 'remote', relayUsable: true })).toBe(false)
  })

  it('needs an address for a remote machine without a relay', () => {
    expect(harnessNeedsAddress({ ...base, machine: 'remote' })).toBe(true)
    expect(harnessNeedsAddress({ ...base, machine: 'remote', direct: true })).toBe(false)
  })

  it('needs an address for a container without a known container URL', () => {
    expect(harnessNeedsAddress({ ...base, target: 'container' })).toBe(true)
    expect(
      harnessNeedsAddress({
        ...base,
        target: 'container',
        containerUrl: 'ws://172.17.0.1:8788/ws',
      })
    ).toBe(false)
    expect(harnessNeedsAddress({ ...base, target: 'container', containerized: true })).toBe(false)
  })
})

describe('isLoopbackSocketUrl', () => {
  it('recognizes loopback addresses', () => {
    expect(isLoopbackSocketUrl('ws://127.0.0.1:8788/ws')).toBe(true)
    expect(isLoopbackSocketUrl('ws://localhost:8788/ws')).toBe(true)
    expect(isLoopbackSocketUrl('ws://[::1]:8788/ws')).toBe(true)
    expect(isLoopbackSocketUrl('ws://192.168.1.20:8788/ws')).toBe(false)
    expect(isLoopbackSocketUrl('wss://relay.example/room')).toBe(false)
    expect(isLoopbackSocketUrl('not a url')).toBe(false)
  })
})

describe('defaultHarnessConnectionMode', () => {
  const base = {
    machine: 'local' as const,
    target: 'host' as const,
    containerized: false,
    relayUsable: true,
    defaultTransport: 'local' as const,
  }

  it('uses direct when the relay is unavailable', () => {
    expect(defaultHarnessConnectionMode({ ...base, relayUsable: false })).toBe('direct')
  })

  it('uses relay for a remote or relay-connected client', () => {
    expect(defaultHarnessConnectionMode({ ...base, machine: 'remote' })).toBe('relay')
    expect(defaultHarnessConnectionMode({ ...base, defaultTransport: 'relay' })).toBe('relay')
  })

  it('uses relay for a container without a known container URL', () => {
    expect(defaultHarnessConnectionMode({ ...base, target: 'container' })).toBe('relay')
    expect(
      defaultHarnessConnectionMode({
        ...base,
        target: 'container',
        containerUrl: 'ws://172.17.0.1:8788/ws',
      })
    ).toBe('direct')
  })
})
