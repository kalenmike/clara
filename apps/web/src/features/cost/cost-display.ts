import { notifySettingChanged } from '@/lib/setting-events'
import type { CostDisplaySource } from '@/features/cost/estimate'

export type { CostDisplaySource }

const COST_DISPLAY_KEY = 'clara.costDisplay'

const SOURCES: readonly CostDisplaySource[] = ['actual', 'estimated']

let cached: CostDisplaySource | null = null
const listeners = new Set<() => void>()

export function isCostDisplaySource(value: unknown): value is CostDisplaySource {
  return typeof value === 'string' && (SOURCES as readonly string[]).includes(value)
}

export function readCostDisplay(): CostDisplaySource {
  if (cached !== null) return cached

  try {
    const value = window.localStorage.getItem(COST_DISPLAY_KEY)
    cached = isCostDisplaySource(value) ? value : 'actual'
  } catch {
    cached = 'actual'
  }

  return cached
}

export function saveCostDisplay(source: CostDisplaySource): void {
  cached = source

  try {
    window.localStorage.setItem(COST_DISPLAY_KEY, source)
  } catch {
    // Storage can be unavailable in private browsing; keep the in-memory choice.
  }

  notifySettingChanged(COST_DISPLAY_KEY)
  for (const listener of listeners) listener()
}

export function subscribeCostDisplay(listener: () => void): () => void {
  listeners.add(listener)

  const onStorage = (event: StorageEvent) => {
    if (event.key !== COST_DISPLAY_KEY) return
    cached = null
    listener()
  }
  window.addEventListener('storage', onStorage)

  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}

export { COST_DISPLAY_KEY }
