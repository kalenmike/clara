const SIMPLIFY_SETTINGS_KEY = 'clara.simplifySettings'

let cached: boolean | null = null
const listeners = new Set<() => void>()

export function readSimplifySettings(): boolean {
  if (cached !== null) return cached

  try {
    // Simplified is the default, so only an explicit opt-out turns it off.
    cached = window.localStorage.getItem(SIMPLIFY_SETTINGS_KEY) !== 'off'
  } catch {
    cached = true
  }

  return cached
}

export function saveSimplifySettings(simplified: boolean): void {
  cached = simplified

  try {
    window.localStorage.setItem(SIMPLIFY_SETTINGS_KEY, simplified ? 'on' : 'off')
  } catch {
    // Storage can be unavailable in private browsing; keep the in-memory choice.
  }

  for (const listener of listeners) listener()
}

export function subscribeSimplifySettings(listener: () => void): () => void {
  listeners.add(listener)

  const onStorage = (event: StorageEvent) => {
    if (event.key !== SIMPLIFY_SETTINGS_KEY) return
    cached = null
    listener()
  }
  window.addEventListener('storage', onStorage)

  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}
