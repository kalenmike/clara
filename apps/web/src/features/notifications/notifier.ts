import { ATTENTION_LABELS, type AttentionKind } from './attention'
import { getServiceWorkerRegistration } from './push'

export type NotificationPermissionState = NotificationPermission | 'unsupported'

export function readNotificationPermission(): NotificationPermissionState {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported'
  return Notification.permission
}

export async function requestNotificationPermission(): Promise<NotificationPermissionState> {
  if (!('Notification' in window)) return 'unsupported'
  try {
    return await Notification.requestPermission()
  } catch {
    return readNotificationPermission()
  }
}

export async function showDesktopNotification(input: {
  kind: AttentionKind
  sessionID: string
  body: string
  url: string
  onOpen: () => void
}): Promise<void> {
  if (readNotificationPermission() !== 'granted') return

  const title = `Clara · ${ATTENTION_LABELS[input.kind]}`
  try {
    const registration = await getServiceWorkerRegistration()
    if (registration) {
      await registration.showNotification(title, {
        body: input.body,
        tag: `clara:${input.sessionID}`,
        icon: '/favicon.svg',
        badge: '/favicon.svg',
        silent: true,
        data: { url: input.url, sessionID: input.sessionID, kind: input.kind },
      })
      return
    }
  } catch {
    // Fall back to a page notification on browsers without a usable worker.
  }

  try {
    const notification = new Notification(title, {
      body: input.body,
      tag: `clara:${input.sessionID}`,
      icon: '/favicon.svg',
      silent: true,
    })

    notification.onclick = () => {
      window.focus()
      notification.close()
      input.onOpen()
    }
  } catch {
    // Notifications can fail on platforms that expose the API but block it.
  }
}
