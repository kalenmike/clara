import type { ClaraHarnessConnection } from '@clara/api-contract'

export type StreamState = 'connecting' | 'live' | 'reconnecting' | 'offline'

/**
 * Fold one state per supervised stream into the single state the header and
 * sidebar show. Every online harness must be live before the app claims live;
 * any unexpected drop keeps the aggregate reconnecting.
 */
export function aggregateStreamState(states: readonly StreamState[]): StreamState {
  if (states.length === 0) return 'offline'
  if (states.every((state) => state === 'live')) return 'live'
  if (states.every((state) => state === 'offline')) return 'offline'
  if (states.every((state) => state === 'connecting')) return 'connecting'
  return 'reconnecting'
}

/** Online harness ids that deserve their own event stream, deduplicated. */
export function onlineHarnessIDs(
  harnesses: readonly Pick<ClaraHarnessConnection, 'harnessID' | 'online'>[]
): string[] {
  const seen = new Set<string>()
  const ids: string[] = []
  for (const harness of harnesses) {
    if (!harness.online || seen.has(harness.harnessID)) continue
    seen.add(harness.harnessID)
    ids.push(harness.harnessID)
  }
  return ids.sort()
}
