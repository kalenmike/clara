import type { ClaraSession, ClaraSessionsHarnessStatus } from '@clara/api-contract'

/**
 * Enough to count every session in normal projects while keeping a single
 * request bounded. Counts at or above the cap are shown with a `+`.
 */
export const PROJECT_STATS_LIMIT = 1000

export type ProjectStats = {
  active: number
  archived: number
  total: number
  truncated: boolean
  /** Per-harness answers behind a fan-out project list. */
  harnesses: ReadonlyArray<ClaraSessionsHarnessStatus>
  /** True when at least one linked harness failed or was offline. */
  partial: boolean
}

export function summarizeProjectSessions(
  sessions: ReadonlyArray<Pick<ClaraSession, 'time'>>,
  harnesses: ReadonlyArray<ClaraSessionsHarnessStatus> = [],
  limit = PROJECT_STATS_LIMIT
): ProjectStats {
  let archived = 0
  for (const session of sessions) {
    if (session.time.archived != null) archived += 1
  }
  return {
    active: sessions.length - archived,
    archived,
    total: sessions.length,
    truncated: sessions.length >= limit,
    harnesses,
    partial: harnesses.some((harness) => !harness.ok),
  }
}

/** A compact tooltip naming the harnesses that kept the counts partial. */
export function describePartialHarnesses(
  harnesses: ReadonlyArray<ClaraSessionsHarnessStatus>
): string | undefined {
  const incomplete = harnesses.filter((harness) => !harness.ok)
  if (incomplete.length === 0) return undefined
  const names = incomplete.map(
    (harness) => `${harness.label} (${harness.online ? 'failed' : 'offline'})`
  )
  return `Counts exclude ${names.join(', ')}`
}
