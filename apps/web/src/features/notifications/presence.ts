import type { DeviceClass, PresenceSnapshot } from '@clara/shared-types'
import { readNotificationPermission } from './notifier'
import { readNotificationSettings } from './settings'

let cachedDeviceClass: DeviceClass | null = null
let lastActivityAt = Date.now()

type NavigatorWithUaData = {
  userAgent: string
  platform?: string
  maxTouchPoints?: number
  userAgentData?: { mobile?: boolean }
}

export type PresenceChangeReason = 'visibility' | 'focus' | 'pagehide'

export type HoldPhoneInput = {
  deviceClass: DeviceClass
  visible: boolean
  /** True when this client can show a desktop notification on its own. */
  canAlert: boolean
  idleMs: number
  deskIdleMs: number
}

/** Classify a browser, preferring the User-Agent Client Hints signal. */
export function detectDeviceClass(
  nav: NavigatorWithUaData | undefined = navigatorLike()
): DeviceClass {
  if (!nav) return 'desktop'
  if (nav.userAgentData && typeof nav.userAgentData.mobile === 'boolean') {
    return nav.userAgentData.mobile ? 'mobile' : 'desktop'
  }
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(nav.userAgent)) return 'mobile'
  if (nav.platform === 'MacIntel' && (nav.maxTouchPoints ?? 0) > 1) return 'mobile'
  return 'desktop'
}

function navigatorLike(): NavigatorWithUaData | undefined {
  if (typeof navigator === 'undefined') return undefined
  return navigator as unknown as NavigatorWithUaData
}

/** A desktop client holds mobile pushes while visible and recently active. */
export function shouldHoldPhone(input: HoldPhoneInput): boolean {
  return (
    input.deviceClass === 'desktop' &&
    input.visible &&
    input.canAlert &&
    input.idleMs <= input.deskIdleMs
  )
}

export function readDeviceClass(): DeviceClass {
  cachedDeviceClass ??= detectDeviceClass()
  return cachedDeviceClass
}

/** Record pointer, keyboard, or arrival activity. */
export function markActivity(at = Date.now()): void {
  lastActivityAt = at
}

/**
 * A desktop client holds mobile pushes while its window is visible and the
 * person has been active within the configured idle window.
 */
export function readPresenceSnapshot(
  options: { leaving?: boolean; now?: number } = {}
): PresenceSnapshot {
  const now = options.now ?? Date.now()
  const settings = readNotificationSettings()
  const deviceClass = readDeviceClass()
  const visible =
    options.leaving !== true &&
    typeof document !== 'undefined' &&
    document.visibilityState === 'visible'
  const idleMs = Math.max(0, now - lastActivityAt)
  // Only the page can alert the desk while its window is visible: the service
  // worker suppresses that same window's push. Never mute the phone otherwise.
  const canAlert = settings.desktop && readNotificationPermission() === 'granted'

  return {
    deviceClass,
    visible,
    idleMs,
    holdPhone: shouldHoldPhone({
      deviceClass,
      visible,
      canAlert,
      idleMs,
      deskIdleMs: settings.deskIdleMs,
    }),
  }
}

/**
 * Track activity and visibility for the lifetime of a connection. Calling
 * `onChange` more often than the heartbeat is fine; each ping is cheap.
 */
export function installPresenceTracking(
  onChange: (reason: PresenceChangeReason) => void
): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => {}

  const onActivity = () => markActivity()
  const onVisibility = () => {
    if (document.visibilityState === 'visible') markActivity()
    onChange('visibility')
  }
  const onFocus = () => {
    markActivity()
    onChange('focus')
  }
  const onPageHide = () => onChange('pagehide')

  document.addEventListener('pointerdown', onActivity, true)
  document.addEventListener('keydown', onActivity, true)
  document.addEventListener('touchstart', onActivity, { capture: true, passive: true })
  document.addEventListener('wheel', onActivity, { capture: true, passive: true })
  document.addEventListener('visibilitychange', onVisibility)
  window.addEventListener('focus', onFocus)
  window.addEventListener('pagehide', onPageHide)

  return () => {
    document.removeEventListener('pointerdown', onActivity, true)
    document.removeEventListener('keydown', onActivity, true)
    document.removeEventListener('touchstart', onActivity, true)
    document.removeEventListener('wheel', onActivity, true)
    document.removeEventListener('visibilitychange', onVisibility)
    window.removeEventListener('focus', onFocus)
    window.removeEventListener('pagehide', onPageHide)
  }
}
