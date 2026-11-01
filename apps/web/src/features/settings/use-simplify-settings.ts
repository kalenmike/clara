import { useCallback, useSyncExternalStore } from 'react'
import {
  readSimplifySettings,
  saveSimplifySettings,
  subscribeSimplifySettings,
} from '@/features/settings/simplify-settings'

export function useSimplifySettings() {
  const simplified = useSyncExternalStore(
    subscribeSimplifySettings,
    readSimplifySettings,
    readSimplifySettings
  )

  const setSimplified = useCallback((next: boolean) => {
    saveSimplifySettings(next)
  }, [])

  return { simplified, setSimplified }
}
