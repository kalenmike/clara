import { useEffect, useState } from 'react'
import { readNotificationPermission, type NotificationPermissionState } from './notifier'

export function useNotificationPermission() {
  const [permission, setPermission] = useState<NotificationPermissionState>(
    readNotificationPermission
  )

  useEffect(() => {
    const refresh = () => setPermission(readNotificationPermission())
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [])

  return { permission, setPermission }
}
