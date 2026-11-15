export const COMPOSER_AUTO_HIDE_KEY = 'clara.composerAutoHide'
export const COMPOSER_PINNED_KEY = 'clara.composerPinned'

let autoHideCache: boolean | null = null
let pinnedCache: boolean | null = null
const autoHideListeners = new Set<() => void>()
const pinnedListeners = new Set<() => void>()

export function readComposerAutoHide(): boolean {
  if (autoHideCache !== null) return autoHideCache

  try {
    autoHideCache = window.localStorage.getItem(COMPOSER_AUTO_HIDE_KEY) === 'on'
  } catch {
    autoHideCache = false
  }

  return autoHideCache
}

export function saveComposerAutoHide(enabled: boolean): void {
  autoHideCache = enabled

  try {
    window.localStorage.setItem(COMPOSER_AUTO_HIDE_KEY, enabled ? 'on' : 'off')
  } catch {
    // Storage can be unavailable in private browsing; keep the in-memory choice.
  }

  for (const listener of autoHideListeners) listener()

  // Pin is an override of auto-hide; turning auto-hide off drops it so
  // re-enabling starts hidden again.
  if (!enabled) saveComposerPinned(false)
}

export function subscribeComposerAutoHide(listener: () => void): () => void {
  autoHideListeners.add(listener)

  const onStorage = (event: StorageEvent) => {
    if (event.key !== COMPOSER_AUTO_HIDE_KEY) return
    autoHideCache = null
    listener()
  }
  window.addEventListener('storage', onStorage)

  return () => {
    autoHideListeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}

export function readComposerPinned(): boolean {
  if (pinnedCache !== null) return pinnedCache

  try {
    pinnedCache = window.localStorage.getItem(COMPOSER_PINNED_KEY) === 'on'
  } catch {
    pinnedCache = false
  }

  return pinnedCache
}

export function saveComposerPinned(pinned: boolean): void {
  pinnedCache = pinned

  try {
    window.localStorage.setItem(COMPOSER_PINNED_KEY, pinned ? 'on' : 'off')
  } catch {
    // Storage can be unavailable in private browsing; keep the in-memory choice.
  }

  for (const listener of pinnedListeners) listener()
}

export function subscribeComposerPinned(listener: () => void): () => void {
  pinnedListeners.add(listener)

  const onStorage = (event: StorageEvent) => {
    if (event.key !== COMPOSER_PINNED_KEY) return
    pinnedCache = null
    listener()
  }
  window.addEventListener('storage', onStorage)

  return () => {
    pinnedListeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}
