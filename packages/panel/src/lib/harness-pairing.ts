import type { PanelHarness, PanelHarnessPairing } from '@clara/shared-types'

/** The adapters this release can install, in the order the modal offers them. */
export const HARNESS_KINDS = [
  { kind: 'opencode', label: 'OpenCode' },
  { kind: 'claude', label: 'Claude Code' },
  { kind: 'pi', label: 'Pi' },
] as const

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
