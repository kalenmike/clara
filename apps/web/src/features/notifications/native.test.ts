import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/runtime', () => ({ isDesktop: true }))

import {
  focusMainWindow,
  nativeNotificationsAvailable,
  showNativeNotification,
  subscribeNativeNotificationActions,
} from './native'

type TauriWindow = {
  __TAURI__?: {
    core?: { invoke?: (command: string, args?: Record<string, unknown>) => Promise<unknown> }
    notification?: {
      sendNotification?: (options: Record<string, unknown>) => void
      onAction?: (
        callback: (event: unknown) => void
      ) => Promise<{ unregister: () => Promise<void> }>
    }
  }
}

const originalWindow = (globalThis as { window?: unknown }).window

function installWindow(value: TauriWindow | undefined): void {
  ;(globalThis as { window?: unknown }).window =
    value === undefined ? undefined : (value as unknown)
}

beforeEach(() => {
  installWindow(undefined)
})

afterEach(() => {
  installWindow(originalWindow as TauriWindow | undefined)
  vi.restoreAllMocks()
})

describe('native notifications', () => {
  it('is available only with the desktop notification API', () => {
    expect(nativeNotificationsAvailable()).toBe(false)

    installWindow({ __TAURI__: { notification: {} } })
    expect(nativeNotificationsAvailable()).toBe(false)

    installWindow({ __TAURI__: { notification: { sendNotification: vi.fn() } } })
    expect(nativeNotificationsAvailable()).toBe(true)
  })

  it('sends a title, body, and click payload to the plugin', () => {
    const sendNotification = vi.fn()
    installWindow({ __TAURI__: { notification: { sendNotification } } })

    expect(
      showNativeNotification({
        title: 'Clara · Ready for Review',
        body: 'Agent finished.',
        extra: { url: '/p/project/s/session', sessionID: 'session' },
      })
    ).toBe(true)
    expect(sendNotification).toHaveBeenCalledWith({
      title: 'Clara · Ready for Review',
      body: 'Agent finished.',
      extra: { url: '/p/project/s/session', sessionID: 'session' },
    })
  })

  it('omits empty body and extra fields', () => {
    const sendNotification = vi.fn()
    installWindow({ __TAURI__: { notification: { sendNotification } } })

    expect(showNativeNotification({ title: 'Clara' })).toBe(true)
    expect(sendNotification).toHaveBeenCalledWith({ title: 'Clara' })
  })

  it('reports a failed native send instead of throwing', () => {
    installWindow({
      __TAURI__: {
        notification: {
          sendNotification: () => {
            throw new Error('notification service unavailable')
          },
        },
      },
    })

    expect(showNativeNotification({ title: 'Clara' })).toBe(false)
  })

  it('reports only taps and forwards the notification payload', async () => {
    let callback: ((event: unknown) => void) | undefined
    const unregister = vi.fn().mockResolvedValue(undefined)
    const onAction = vi.fn((handler: (event: unknown) => void) => {
      callback = handler
      return Promise.resolve({ unregister })
    })
    installWindow({ __TAURI__: { notification: { sendNotification: vi.fn(), onAction } } })

    const handler = vi.fn()
    const stop = subscribeNativeNotificationActions(handler)
    await vi.waitFor(() => expect(onAction).toHaveBeenCalled())
    await Promise.resolve()

    callback?.({
      actionId: 'tap',
      notification: { extra: { url: '/p/project/s/one', sessionID: 'one' } },
    })
    expect(handler).toHaveBeenCalledWith({ url: '/p/project/s/one', sessionID: 'one' })

    callback?.({ actionId: 'dismiss', notification: { extra: { url: '/ignored' } } })
    expect(handler).toHaveBeenCalledTimes(1)

    stop()
    expect(unregister).toHaveBeenCalledTimes(1)
  })

  it('focuses the main window through the shell command', async () => {
    const invoke = vi.fn().mockResolvedValue(undefined)
    installWindow({ __TAURI__: { core: { invoke } } })

    await focusMainWindow()
    expect(invoke).toHaveBeenCalledWith('focus_main_window')
  })
})
