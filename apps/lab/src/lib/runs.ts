import type { RunRow } from '../types'

/** Runs started by the lab carry this harness marker. */
export const DEBUG_HARNESS = 'clara-lab'

const ACTIVE_STATES = new Set(['running', 'waiting', 'queued'])

export function isDebugRun(run: Pick<RunRow, 'origin_harness'>): boolean {
  return run.origin_harness === DEBUG_HARNESS
}

export function isActiveRunState(state: string): boolean {
  return ACTIVE_STATES.has(state)
}

export function isActiveRun(run: Pick<RunRow, 'state'>): boolean {
  return isActiveRunState(run.state)
}

export function visibleRuns(runs: RunRow[], showDebug: boolean): RunRow[] {
  return showDebug ? runs : runs.filter((run) => !isDebugRun(run))
}

export function debugRuns(runs: RunRow[]): RunRow[] {
  return runs.filter(isDebugRun)
}

/**
 * Active runs first, preserving the service order inside each group.
 */
export function sortRuns(runs: RunRow[]): RunRow[] {
  return [...runs].sort((left, right) => Number(!isActiveRun(left)) - Number(!isActiveRun(right)))
}
