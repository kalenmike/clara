import type { PushSubscriptionPayload } from '@clara/shared-types'

const REGISTRATION_TIMEOUT_MS = 5_000
let activeCache: Promise<boolean> | null = null

export function pushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  )
}

export function isIos(): boolean {
  if (typeof navigator === 'undefined') return false
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  )
}

export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  const navigatorWithStandalone = navigator as Navigator & { standalone?: boolean }
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    navigatorWithStandalone.standalone === true
  )
}

export async function getServiceWorkerRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null

  const existing = await navigator.serviceWorker.getRegistration()
  if (!existing) return null

  try {
    return await withTimeout(navigator.serviceWorker.ready, REGISTRATION_TIMEOUT_MS)
  } catch {
    return existing
  }
}

/** True when this browser has an active push subscription, regardless of the UI intent. */
export function isPushActive(): Promise<boolean> {
  if (!pushSupported()) return Promise.resolve(false)
  if (activeCache) return activeCache

  activeCache = (async () => {
    try {
      const registration = await getServiceWorkerRegistration()
      if (!registration) return false
      return Boolean(await registration.pushManager.getSubscription())
    } catch {
      return false
    }
  })()
  return activeCache
}

export function resetPushActiveCache(): void {
  activeCache = null
}

export async function readPushSubscription(): Promise<PushSubscription | null> {
  const registration = await getServiceWorkerRegistration()
  if (!registration) return null
  return registration.pushManager.getSubscription()
}

export async function subscribeToPush(publicKey: string): Promise<PushSubscription> {
  const registration = await getServiceWorkerRegistration()
  if (!registration) {
    throw new Error('Clara is not running from a registered service worker yet')
  }

  const applicationServerKey = urlBase64ToUint8Array(publicKey)
  let subscription = await registration.pushManager.getSubscription()

  if (subscription && !hasApplicationServerKey(subscription, applicationServerKey)) {
    await subscription.unsubscribe()
    subscription = null
  }

  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey,
    })
  }

  resetPushActiveCache()
  return subscription
}

export async function unsubscribeFromPush(): Promise<void> {
  try {
    const subscription = await readPushSubscription()
    if (subscription) await subscription.unsubscribe()
  } catch {
    // Disabling push is best effort; the server also prunes dead endpoints.
  } finally {
    resetPushActiveCache()
  }
}

export function toPushSubscriptionPayload(subscription: PushSubscription): PushSubscriptionPayload {
  const json = subscription.toJSON()
  const endpoint = json.endpoint ?? subscription.endpoint
  const p256dh = json.keys?.p256dh
  const auth = json.keys?.auth

  if (!endpoint || !p256dh || !auth) {
    throw new Error('The browser returned an incomplete push subscription')
  }

  return {
    endpoint,
    expirationTime: json.expirationTime ?? null,
    keys: { p256dh, auth },
  }
}

export function urlBase64ToUint8Array(value: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (value.length % 4)) % 4)
  const base64 = `${value}${padding}`.replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const bytes = new Uint8Array(raw.length)
  for (let index = 0; index < raw.length; index += 1) {
    bytes[index] = raw.charCodeAt(index)
  }
  return bytes
}

function hasApplicationServerKey(
  subscription: PushSubscription,
  expected: Uint8Array<ArrayBuffer>
): boolean {
  const current = subscription.options.applicationServerKey
  if (!current) return false
  const bytes = new Uint8Array(current)
  if (bytes.byteLength !== expected.byteLength) return false
  return bytes.every((value, index) => value === expected[index])
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error('Timed out waiting for Clara')), ms)
    promise.then(
      (value) => {
        window.clearTimeout(timer)
        resolve(value)
      },
      (cause) => {
        window.clearTimeout(timer)
        reject(cause)
      }
    )
  })
}
