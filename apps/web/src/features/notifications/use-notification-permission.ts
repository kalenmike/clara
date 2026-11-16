import { useEffect, useState } from 'react'
import { readNotificationPermission, type NotificationPermissionState } from './notifier'

export function useNotificationPermission() {
  const [permission, setPermission] = useState<NotificationPermissionState>(
    readNotificationPermission
  )

  useEffect(() => {
    const refresh = () => setPermission(readNotificationPermission())
    // The desktop notification plugin installs its global API during page
    // startup, so re-read after the first render as well as on focus.
    refresh()
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [])

  return { permission, setPermission }
}
