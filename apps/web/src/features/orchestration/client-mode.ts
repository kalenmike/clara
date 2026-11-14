import { notifySettingChanged } from '@/lib/setting-events'

/**
 * A per-client choice to use the orchestrator surface. It is stored locally so
 * one device can opt in without changing the others; the isolated sync option
 * can share this single key when the person asks for it.
 */
export const ORCHESTRATOR_MODE_KEY = 'clara.orchestratorMode'

let cached: boolean | null = null
const listeners = new Set<() => void>()

export function readOrchestratorMode(): boolean {
  if (cached !== null) return cached

  try {
    cached = window.localStorage.getItem(ORCHESTRATOR_MODE_KEY) === 'on'
  } catch {
    cached = false
  }

  return cached
}

export function saveOrchestratorMode(enabled: boolean): void {
  cached = enabled

  try {
    window.localStorage.setItem(ORCHESTRATOR_MODE_KEY, enabled ? 'on' : 'off')
  } catch {
    // Storage can be unavailable in private browsing; keep the in-memory choice.
  }

  for (const listener of listeners) listener()
  notifySettingChanged(ORCHESTRATOR_MODE_KEY)
}

export function subscribeOrchestratorMode(listener: () => void): () => void {
  listeners.add(listener)

  const onStorage = (event: StorageEvent) => {
    if (event.key !== ORCHESTRATOR_MODE_KEY) return
    cached = null
    readOrchestratorMode()
    listener()
  }
  window.addEventListener('storage', onStorage)

  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}

/** The server gate is authoritative; the client can only opt in while it is on. */
export function orchestratorModeActive(serverEnabled: boolean, optedIn: boolean): boolean {
  return serverEnabled && optedIn
}
