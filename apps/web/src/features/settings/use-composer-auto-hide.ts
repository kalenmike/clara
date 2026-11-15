import { useCallback, useEffect, useSyncExternalStore } from 'react'
import {
  readComposerAutoHide,
  readComposerPinned,
  saveComposerAutoHide,
  saveComposerPinned,
  subscribeComposerAutoHide,
  subscribeComposerPinned,
} from '@/features/settings/composer-auto-hide'

export function useComposerAutoHide() {
  const enabled = useSyncExternalStore(
    subscribeComposerAutoHide,
    readComposerAutoHide,
    readComposerAutoHide
  )
  const pinned = useSyncExternalStore(
    subscribeComposerPinned,
    readComposerPinned,
    readComposerPinned
  )

  const setEnabled = useCallback((next: boolean) => {
    saveComposerAutoHide(next)
  }, [])

  const setPinned = useCallback((next: boolean) => {
    saveComposerPinned(next)
  }, [])

  // The pin only overrides an active auto-hide setting, including one switched
  // off from another tab through the storage event.
  useEffect(() => {
    if (!enabled && pinned) saveComposerPinned(false)
  }, [enabled, pinned])

  return { enabled, pinned, setEnabled, setPinned }
}
