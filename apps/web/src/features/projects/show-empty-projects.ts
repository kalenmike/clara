const SHOW_EMPTY_PROJECTS_KEY = 'clara.showEmptyProjects'

let cached: boolean | null = null
const listeners = new Set<() => void>()

export function readShowEmptyProjects(): boolean {
  if (cached !== null) return cached

  try {
    cached = window.localStorage.getItem(SHOW_EMPTY_PROJECTS_KEY) === 'shown'
  } catch {
    cached = false
  }

  return cached
}

export function saveShowEmptyProjects(show: boolean): void {
  cached = show

  try {
    window.localStorage.setItem(SHOW_EMPTY_PROJECTS_KEY, show ? 'shown' : 'hidden')
  } catch {
    // Storage can be unavailable in private browsing; keep the in-memory choice.
  }

  for (const listener of listeners) listener()
}

export function subscribeShowEmptyProjects(listener: () => void): () => void {
  listeners.add(listener)

  const onStorage = (event: StorageEvent) => {
    if (event.key !== SHOW_EMPTY_PROJECTS_KEY) return
    cached = null
    listener()
  }
  window.addEventListener('storage', onStorage)

  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}
