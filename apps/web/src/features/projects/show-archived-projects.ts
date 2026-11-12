import { notifySettingChanged } from '@/lib/setting-events'

export const SHOW_ARCHIVED_PROJECTS_KEY = 'clara.showArchivedProjects'

let cached: boolean | null = null
const listeners = new Set<() => void>()

export function readShowArchivedProjects(): boolean {
  if (cached !== null) return cached

  try {
    cached = window.localStorage.getItem(SHOW_ARCHIVED_PROJECTS_KEY) === 'shown'
  } catch {
    cached = false
  }

  return cached
}

export function saveShowArchivedProjects(show: boolean): void {
  cached = show

  try {
    window.localStorage.setItem(SHOW_ARCHIVED_PROJECTS_KEY, show ? 'shown' : 'hidden')
  } catch {
    // Storage can be unavailable in private browsing; keep the in-memory choice.
  }

  for (const listener of listeners) listener()
  notifySettingChanged(SHOW_ARCHIVED_PROJECTS_KEY)
}

export function subscribeShowArchivedProjects(listener: () => void): () => void {
  listeners.add(listener)

  const onStorage = (event: StorageEvent) => {
    if (event.key !== SHOW_ARCHIVED_PROJECTS_KEY) return
    cached = null
    listener()
  }
  window.addEventListener('storage', onStorage)

  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}
