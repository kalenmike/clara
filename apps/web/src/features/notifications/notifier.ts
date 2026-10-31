import { ATTENTION_LABELS, type AttentionKind } from './attention'

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

export function showDesktopNotification(input: {
  kind: AttentionKind
  sessionID: string
  body: string
  onOpen: () => void
}): void {
  if (readNotificationPermission() !== 'granted') return

  try {
    const notification = new Notification(`Clara · ${ATTENTION_LABELS[input.kind]}`, {
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
