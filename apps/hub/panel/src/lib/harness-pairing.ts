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

/**
 * The transport follows from the machine choice and, for a local harness,
 * whether it runs inside the hub's Docker network. A container on a hub that
 * runs as a host process cannot reach the hub's loopback listener, so it falls
 * back to the relay just like a remote host does.
 */
export function resolveHarnessTransport(input: {
  machine: HarnessMachine
  useDocker?: boolean
  containerized: boolean
}): HarnessTransportMode {
  if (input.machine === 'remote') return 'relay'
  if (input.useDocker) return input.containerized ? 'docker' : 'relay'
  return 'local'
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
