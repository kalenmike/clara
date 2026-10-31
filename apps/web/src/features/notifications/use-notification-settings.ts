import { useCallback, useSyncExternalStore } from 'react'
import {
  readNotificationSettings,
  saveNotificationSettings,
  subscribeNotificationSettings,
  type NotificationSettings,
} from './settings'

export function useNotificationSettings() {
  const settings = useSyncExternalStore(
    subscribeNotificationSettings,
    readNotificationSettings,
    readNotificationSettings
  )

  const update = useCallback((patch: Partial<NotificationSettings>) => {
    saveNotificationSettings({ ...readNotificationSettings(), ...patch })
  }, [])

  return { settings, update }
}
