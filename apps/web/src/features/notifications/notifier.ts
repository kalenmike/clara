import { ATTENTION_LABELS, type AttentionKind } from './attention'
import { nativeNotificationsAvailable, showNativeNotification } from './native'
import { getServiceWorkerRegistration } from './push'

export type NotificationPermissionState = NotificationPermission | 'unsupported'

export function readNotificationPermission(): NotificationPermissionState {
  // The desktop shell's notification plugin grants permission itself and does
  // not expose the Web Notifications permission model.
  if (nativeNotificationsAvailable()) return 'granted'
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported'
  return Notification.permission
}

export async function requestNotificationPermission(): Promise<NotificationPermissionState> {
  if (nativeNotificationsAvailable()) return 'granted'
  if (!('Notification' in window)) return 'unsupported'
  try {
    return await Notification.requestPermission()
  } catch {
    return readNotificationPermission()
  }
}

/**
 * Shows a one-off system notification so the person can check that desktop
 * alerts reach the operating system. Returns false when the browser refused.
 */
export async function showTestDesktopNotification(): Promise<boolean> {
  if (readNotificationPermission() !== 'granted') return false

  const title = 'Clara · Test'
  const body = 'Desktop notifications are working. Inbox alerts will look like this.'
  if (nativeNotificationsAvailable()) {
    return showNativeNotification({
      title,
      body,
      extra: { sessionID: 'test', kind: 'review' },
    })
  }

  const options: NotificationOptions = {
    body,
    tag: 'clara:test',
    icon: '/favicon.png',
    badge: '/favicon.png',
    silent: true,
    data: {
      url: `${window.location.pathname}${window.location.search}`,
      sessionID: 'test',
      kind: 'review',
    },
  }

  try {
    const registration = await getServiceWorkerRegistration()
    if (registration) {
      await registration.showNotification(title, options)
      return true
    }
  } catch {
    // Fall back to a page notification on browsers without a usable worker.
  }

  try {
    const notification = new Notification(title, options)
    notification.onclick = () => {
      window.focus()
      notification.close()
    }
    return true
  } catch {
    return false
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
  if (nativeNotificationsAvailable()) {
    if (
      showNativeNotification({
        title,
        body: input.body,
        extra: {
          url: input.url,
          sessionID: input.sessionID,
          kind: input.kind,
        },
      })
    ) {
      return
    }
  }

  try {
    const registration = await getServiceWorkerRegistration()
    if (registration) {
      await registration.showNotification(title, {
        body: input.body,
        tag: `clara:${input.sessionID}`,
        icon: '/favicon.png',
        badge: '/favicon.png',
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
      icon: '/favicon.png',
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
