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

export type WorkerBuild = {
  /** Build identity shared by the page and the worker that produced it. */
  id: string
  /** ISO build time, used to tell a newer worker from an older one. */
  at: string
}

export type UpdateOffer = {
  /** The build this page is running. */
  running: WorkerBuild
  /** The waiting worker's build, or null when it predates the build message. */
  waiting: WorkerBuild | null
}

/**
 * Decide whether a waiting worker is worth offering.
 *
 * A byte-identical worker is never installed on its own, but the browser can
 * still report one — a rebuild of the same commit, or a Safari copy of the
 * active worker. Those are not updates. Neither is a worker built before the
 * running page: a deploy served out of order must never prompt a downgrade.
 * Workers that cannot answer the build message are assumed to be real updates.
 */
export function shouldOfferUpdate({ running, waiting }: UpdateOffer): boolean {
  if (!waiting) return true
  if (waiting.id === running.id) return false
  const waitingAt = Date.parse(waiting.at)
  const runningAt = Date.parse(running.at)
  if (Number.isFinite(waitingAt) && Number.isFinite(runningAt) && waitingAt <= runningAt)
    return false
  return true
}

/** How long a build applied on this page is ignored if it is offered again. */
export const APPLIED_GUARD_MS = 5 * 60_000

export type AppliedBuild = {
  id: string
  /** When it was applied, used to expire the guard. */
  at: number
}

/**
 * After an update reload the browser can still report the worker that was just
 * applied, especially when the reload lands before it takes control. Ignore
 * that build for a while instead of offering it straight back.
 */
export function isRecentlyApplied({
  applied,
  buildId,
  now,
}: {
  applied: AppliedBuild | null
  buildId: string | null
  now: number
}): boolean {
  if (!applied || !buildId) return false
  return applied.id === buildId && now - applied.at < APPLIED_GUARD_MS
}
