import type { ClaraSession } from '@clara/api-contract'

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
}

export function summarizeProjectSessions(
  sessions: ReadonlyArray<Pick<ClaraSession, 'time'>>,
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
  }
}
