import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { DeliveryState } from './delivery.ts'

export const DELIVERY_STATE_LIMIT = 500

export function readDeliveryState(path: string): DeliveryState {
  if (!existsSync(path)) return { alerts: new Set(), runs: new Set() }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as {
      alerts?: unknown
      runs?: unknown
    }
    const ids = (value: unknown): Set<number> =>
      new Set(Array.isArray(value) ? value.map(Number).filter(Number.isFinite) : [])
    return { alerts: ids(parsed.alerts), runs: ids(parsed.runs) }
  } catch {
    return { alerts: new Set(), runs: new Set() }
  }
}

/** Best-effort persistence. A lost file re-sends one open alert. */
export function writeDeliveryState(
  path: string,
  state: DeliveryState,
  limit = DELIVERY_STATE_LIMIT
): void {
  try {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
    writeFileSync(
      path,
      `${JSON.stringify({
        alerts: [...state.alerts].slice(-limit),
        runs: [...state.runs].slice(-limit),
      })}\n`,
      { mode: 0o600 }
    )
  } catch {
    // Delivery state is best effort.
  }
}
