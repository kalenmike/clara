import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/runtime', () => ({ isDesktop: true }))

import {
  readNotificationPermission,
  requestNotificationPermission,
  showDesktopNotification,
  showTestDesktopNotification,
} from './notifier'

const originalWindow = (globalThis as { window?: unknown }).window

function installDesktopWindow(sendNotification: (options: Record<string, unknown>) => void): void {
  ;(globalThis as { window?: unknown }).window = {
    __TAURI__: { notification: { sendNotification } },
  }
}

beforeEach(() => {
  installDesktopWindow(() => {})
})

afterEach(() => {
  ;(globalThis as { window?: unknown }).window = originalWindow
  vi.restoreAllMocks()
})

describe('desktop notification permission', () => {
  it('is granted by the native notification plugin', async () => {
    expect(readNotificationPermission()).toBe('granted')
    await expect(requestNotificationPermission()).resolves.toBe('granted')
  })

  it('sends a test notification through the native API', async () => {
    const sendNotification = vi.fn()
    installDesktopWindow(sendNotification)

    await expect(showTestDesktopNotification()).resolves.toBe(true)
    expect(sendNotification).toHaveBeenCalledWith({
      title: 'Clara · Test',
      body: 'Desktop notifications are working. Inbox alerts will look like this.',
      extra: { sessionID: 'test', kind: 'review' },
    })
  })

  it('sends inbox alerts with the session URL for click routing', async () => {
    const sendNotification = vi.fn()
    installDesktopWindow(sendNotification)

    await showDesktopNotification({
      kind: 'question',
      sessionID: 'session-1',
      body: 'Agent is waiting on you in “Fix login”.',
      url: '/p/project/s/session-1',
      onOpen: vi.fn(),
    })

    expect(sendNotification).toHaveBeenCalledWith({
      title: 'Clara · Needs Input',
      body: 'Agent is waiting on you in “Fix login”.',
      extra: {
        url: '/p/project/s/session-1',
        sessionID: 'session-1',
        kind: 'question',
      },
    })
  })
})
