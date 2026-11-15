import type { PanelHarness, PanelHarnessPairing } from '@clara/shared-types'

/** The adapters this release can install, in the order the modal offers them. */
export const HARNESS_KINDS = [
  { kind: 'opencode', label: 'OpenCode' },
  { kind: 'claude', label: 'Claude Code' },
  { kind: 'pi', label: 'Pi' },
] as const

/** Where the harness runs, as the person installing the adapter sees it. */
export type HarnessMachine = 'remote' | 'local'

/** The address family the adapter uses to reach the hub. */
export type HarnessTransportMode = 'relay' | 'docker' | 'local'

/** Where a local harness runs, as the person installing the adapter sees it. */
export type HarnessTarget = 'host' | 'container'

/** The two ways an adapter can reach the hub. */
export type HarnessConnectionMode = 'relay' | 'direct'

/**
 * The connection mode the modal starts on. Relay leads when it is configured
 * and the target cannot use the hub's loopback listener; otherwise Direct is
 * the least surprising default. The person can always switch.
 */
export function defaultHarnessConnectionMode(input: {
  machine: HarnessMachine
  target: HarnessTarget
  containerized: boolean
  relayUsable: boolean
  defaultTransport: 'local' | 'relay'
  containerUrl?: string
}): HarnessConnectionMode {
  if (!input.relayUsable) return 'direct'
  if (resolveHarnessTransport(input) === 'relay') return 'relay'
  if (input.target === 'container' && !input.containerized && !input.containerUrl) return 'relay'
  return 'direct'
}

/**
 * The transport follows from the machine choice, the local target, and the
 * connection carrying the panel. A remote adapter cannot reach the hub's
 * loopback listener, and a client already on the relay should not hand out a
 * hub-local address it cannot reach. A local container uses the Docker network
 * whenever one is available; the address is resolved separately.
 */
export function resolveHarnessTransport(input: {
  machine: HarnessMachine
  target: HarnessTarget
  containerized: boolean
  defaultTransport: 'local' | 'relay'
}): HarnessTransportMode {
  if (input.machine === 'remote') return 'relay'
  if (input.target === 'container') {
    if (input.defaultTransport === 'relay') return 'relay'
    return 'docker'
  }
  return input.defaultTransport
}

/** The transport a direct WebSocket URL uses. */
export function directHarnessTransport(input: {
  target: HarnessTarget
  containerized: boolean
}): HarnessTransportMode {
  return input.target === 'container' ? 'docker' : 'local'
}

/**
 * Whether a direct URL points at the hub's own loopback. A remote or container
 * adapter can only use it through a tunnel; the panel warns but does not block.
 */
export function isLoopbackSocketUrl(url: string): boolean {
  const value = url.trim()
  if (!value) return false
  try {
    const host = new URL(value).hostname.replace(/^\[(.*)\]$/, '$1').toLowerCase()
    return host === '127.0.0.1' || host === '::1' || host === 'localhost'
  } catch {
    return false
  }
}

/**
 * Whether the selected target needs a typed direct address. A remote machine
 * without a relay, or a local container on a host-process hub without a known
 * container address, cannot use the hub's default loopback URL.
 */
export function harnessNeedsAddress(input: {
  machine: HarnessMachine
  target: HarnessTarget
  containerized: boolean
  relayUsable: boolean
  containerUrl?: string
  direct: boolean
}): boolean {
  if (input.direct) return false
  if (input.machine === 'remote') return !input.relayUsable
  if (input.target !== 'container') return false
  if (input.containerized) return false
  return !input.containerUrl
}

/**
 * The target a local harness starts on. A containerized hub is usually paired
 * with a harness container, and a host-process hub with an adapter on the host.
 */
export function defaultHarnessTarget(containerized: boolean): HarnessTarget {
  return containerized ? 'container' : 'host'
}

/**
 * A pending adapter pairing is done once a harness of the same kind reports a
 * connection created or seen after the code was issued. The snapshot only
 * carries harness connections, not pairing records, so this is the signal the
 * panel can observe without another request.
 */
export function findHarnessPairingConnection(
  pairing: Pick<PanelHarnessPairing, 'kind' | 'createdAt'>,
  harnesses: PanelHarness[]
): PanelHarness | undefined {
  const issuedAt = Date.parse(pairing.createdAt)
  if (Number.isNaN(issuedAt)) return undefined

  return harnesses.find((harness) => {
    if (harness.kind !== pairing.kind) return false
    const seenAt = harness.lastSeenAt ? Date.parse(harness.lastSeenAt) : Number.NaN
    const createdAt = Date.parse(harness.createdAt)
    return seenAt >= issuedAt || createdAt >= issuedAt
  })
}

export function isPairingRegistered(
  pairing: Pick<PanelHarnessPairing, 'kind' | 'createdAt'>,
  harnesses: PanelHarness[]
): boolean {
  return findHarnessPairingConnection(pairing, harnesses) !== undefined
}
