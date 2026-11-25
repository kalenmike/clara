import type { EngineAdapterRow, RunnerSnapshot } from './types.ts'

/** Matches the engine watchdog's default `adapterStaleMs`. */
export const RUNNER_STALE_MS = 120_000

/**
 * Turn engine adapter rows into runner snapshots with age and liveness.
 * A runner is live while its heartbeat is younger than the stale window the
 * engine uses to decide a workspace has no executor.
 */
export function runnerSnapshots(
  rows: readonly EngineAdapterRow[],
  options: { nowMs?: number; staleMs?: number } = {}
): RunnerSnapshot[] {
  const nowMs = options.nowMs ?? Date.now()
  const staleMs = options.staleMs ?? RUNNER_STALE_MS
  return rows
    .filter((row) => row.role === 'runner')
    .map((row) => {
      const heartbeat = Date.parse(row.heartbeat_at)
      const ageMs = Number.isFinite(heartbeat)
        ? Math.max(0, nowMs - heartbeat)
        : Number.MAX_SAFE_INTEGER
      return {
        id: row.id,
        harness: row.harness,
        machine: row.machine,
        workspace: row.workspace,
        labels: parseJsonArray(row.labels),
        capabilities: parseJsonArray(row.capabilities),
        ageMs,
        live: ageMs <= staleMs,
      }
    })
    .sort((a, b) => Number(b.live) - Number(a.live) || a.ageMs - b.ageMs)
}

function parseJsonArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : []
  } catch {
    return []
  }
}
