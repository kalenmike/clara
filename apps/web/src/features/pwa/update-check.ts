/** Minimum gap between two checks triggered by focus or resume. */
export const FOCUS_CHECK_INTERVAL_MS = 15_000
/** Minimum gap between the background checks that run on their own. */
export const IDLE_CHECK_INTERVAL_MS = 60_000

export type UpdateCheckInput = {
  now: number
  lastCheckAt: number
  online: boolean
  /** Focus, resume, and page restore bypass the idle interval. */
  force: boolean
}

/**
 * A worker update check downloads the worker script, so it is worth skipping
 * on a dead network and worth spacing out: an installed app can fire focus and
 * visibility changes several times in a row.
 */
export function dueForUpdateCheck({ now, lastCheckAt, online, force }: UpdateCheckInput): boolean {
  if (!online) return false
  // Zero means this page has never checked; nothing to throttle yet.
  if (lastCheckAt === 0) return true
  const interval = force ? FOCUS_CHECK_INTERVAL_MS : IDLE_CHECK_INTERVAL_MS
  return now - lastCheckAt >= interval
}

export type UpdateCandidate = {
  /** A worker finished installing and is waiting to take over. */
  waiting: boolean
  /** A worker already controls this page. */
  controlled: boolean
}

/**
 * The first install also ends with an installed worker, but there is nothing to
 * update: the page is not controlled yet. Only a controlled page has a real
 * update to offer.
 */
export function isUpdateAvailable({ waiting, controlled }: UpdateCandidate): boolean {
  return waiting && controlled
}
