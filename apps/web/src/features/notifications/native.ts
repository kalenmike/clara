import { isDesktop } from '@/lib/runtime'

/**
 * The slice of `tauri-plugin-notification` exposed by `withGlobalTauri`. The
 * plugin also overrides `window.Notification`, but the global API carries the
 * extra payload and the click listener the desktop notification flow needs.
 */
type NativeNotificationOptions = {
  title: string
  body?: string
  extra?: Record<string, unknown>
}

type NativeNotificationAction = {
  actionId: string
  notification: { extra?: Record<string, unknown> } | null
}

type NativeNotificationListener = {
  unregister: () => Promise<void>
}

type NativeNotificationApi = {
  sendNotification?: (options: NativeNotificationOptions) => void
  onAction?: (
    callback: (event: NativeNotificationAction) => void
  ) => Promise<NativeNotificationListener>
}

type TauriGlobal = {
  core?: {
    invoke?: <T>(command: string, args?: Record<string, unknown>) => Promise<T>
  }
  notification?: NativeNotificationApi
}

type DesktopNotificationAction = {
  url?: string
  sessionID?: string
}

function tauri(): TauriGlobal | undefined {
  if (typeof window === 'undefined') return undefined
  return (window as unknown as { __TAURI__?: TauriGlobal }).__TAURI__
}

function notificationApi(): NativeNotificationApi | undefined {
  return tauri()?.notification
}

/** True when this bundle runs in the desktop shell with the plugin available. */
export function nativeNotificationsAvailable(): boolean {
  return isDesktop && typeof notificationApi()?.sendNotification === 'function'
}

/**
 * Show a native banner without a native sound. Clara keeps its distinct Web
 * Audio motifs in the page, so the OS notification stays silent.
 */
export function showNativeNotification(input: NativeNotificationOptions): boolean {
  const api = notificationApi()
  if (!api?.sendNotification) return false

  try {
    api.sendNotification({
      title: input.title,
      ...(input.body ? { body: input.body } : {}),
      ...(input.extra ? { extra: input.extra } : {}),
    })
    return true
  } catch {
    return false
  }
}

/**
 * Listen for a click on a native notification. The listener must exist before
 * the notification is shown, because the plugin only reports actions for
 * notifications posted while it has a listener.
 */
export function subscribeNativeNotificationActions(
  handler: (action: DesktopNotificationAction) => void
): () => void {
  const api = notificationApi()
  if (!api?.onAction) return () => {}

  let disposed = false
  let stop: (() => void) | undefined

  void api
    .onAction((event) => {
      if (event.actionId !== 'tap') return
      const extra = event.notification?.extra
      const url = typeof extra?.url === 'string' && extra.url.length > 0 ? extra.url : undefined
      const sessionID =
        typeof extra?.sessionID === 'string' && extra.sessionID.length > 0
          ? extra.sessionID
          : undefined
      handler({
        ...(url ? { url } : {}),
        ...(sessionID ? { sessionID } : {}),
      })
    })
    .then((listener) => {
      const unregister = () => {
        void listener.unregister().catch(() => {})
      }
      if (disposed) unregister()
      else stop = unregister
    })
    .catch(() => {})

  return () => {
    disposed = true
    stop?.()
  }
}

/** Bring the desktop window forward after a notification click. */
export async function focusMainWindow(): Promise<void> {
  const invoke = tauri()?.core?.invoke
  if (!invoke) return
  try {
    await invoke('focus_main_window')
  } catch {
    // The window is already gone or the shell is older; navigation still runs.
  }
}
