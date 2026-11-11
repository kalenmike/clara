/** How often a paired client checks the hub for settings changes. */
export const DEFAULT_SYNC_INTERVAL_MS = 30_000
export const MIN_SYNC_INTERVAL_MS = 5_000
export const MAX_SYNC_INTERVAL_MS = 15 * 60_000

/** Offered by the hub panel for the client check cadence. */
export const SYNC_INTERVAL_PRESETS_MS = [
  5_000,
  15_000,
  30_000,
  60_000,
  5 * 60_000,
  15 * 60_000,
] as const

export function isSyncIntervalMs(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= MIN_SYNC_INTERVAL_MS &&
    value <= MAX_SYNC_INTERVAL_MS
  )
}

export function normalizeSyncIntervalMs(value: unknown): number {
  return isSyncIntervalMs(value) ? value : DEFAULT_SYNC_INTERVAL_MS
}
