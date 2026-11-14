import { useSyncExternalStore } from 'react'
import { dueForUpdateCheck, isUpdateAvailable } from '@/features/pwa/update-check'
import { isDesktop } from '@/lib/runtime'

export type UpdateStatus = 'idle' | 'available' | 'applying'

export type UpdateSnapshot = {
  status: UpdateStatus
  /** Set when the user chose "Later"; a newer worker asks again. */
  dismissed: boolean
}

const IDLE: UpdateSnapshot = { status: 'idle', dismissed: false }
const WORKER_URL = '/sw.js'
/** How long to wait for `controllerchange` before reloading anyway. */
const RELOAD_FALLBACK_MS = 3_000

let snapshot: UpdateSnapshot = IDLE
const listeners = new Set<() => void>()
let registrationRequest: Promise<ServiceWorkerRegistration | null> | null = null
let started = false
let lastCheckAt = 0
let reloading = false
/** The waiting worker already offered once, so "Later" is not undone. */
let offered: ServiceWorker | null = null

function setSnapshot(next: UpdateSnapshot) {
  snapshot = next
  for (const listener of listeners) listener()
}

function offerUpdate(worker: ServiceWorker | null) {
  if (snapshot.status === 'applying') return
  if (worker && worker === offered) return
  offered = worker
  setSnapshot({ status: 'available', dismissed: false })
}

function reloadPage() {
  if (reloading) return
  reloading = true
  window.location.reload()
}

function watchInstalling(worker: ServiceWorker, onInstalled: (worker: ServiceWorker) => void) {
  if (worker.state === 'installed') {
    onInstalled(worker)
    return
  }
  worker.addEventListener('statechange', () => {
    if (worker.state === 'installed') onInstalled(worker)
  })
}

function watchRegistration(registration: ServiceWorkerRegistration) {
  // A first install also ends with an installed worker, so the offer only
  // counts on a page that a worker already controls.
  const offer = (worker: ServiceWorker | null) => {
    if (!worker) return
    if (
      !isUpdateAvailable({ waiting: true, controlled: Boolean(navigator.serviceWorker.controller) })
    )
      return
    offerUpdate(worker)
  }

  // The worker can already be waiting when this page starts: the user chose
  // "Later" on an earlier launch, or iOS kept the app suspended.
  offer(registration.waiting)
  // `register()` can resolve after an update was already found, so look at the
  // installing worker too instead of waiting for another `updatefound`.
  if (registration.installing) watchInstalling(registration.installing, offer)

  registration.addEventListener('updatefound', () => {
    if (registration.installing) watchInstalling(registration.installing, offer)
  })
}

/**
 * `updateViaCache: 'none'` keeps a cached worker script from hiding a deploy.
 * The `_headers` rule covers the HTTP cache too; this is the second belt.
 */
function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  registrationRequest ??= (async () => {
    try {
      const registration = await navigator.serviceWorker.register(WORKER_URL, {
        scope: '/',
        updateViaCache: 'none',
      })
      watchRegistration(registration)
      return registration
    } catch (error) {
      console.warn('Clara could not register its service worker.', error)
      return null
    }
  })()
  return registrationRequest
}

async function checkForUpdate({ force }: { force: boolean }) {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return

  const now = Date.now()
  if (!dueForUpdateCheck({ now, lastCheckAt, online: navigator.onLine, force })) return
  lastCheckAt = now

  try {
    const registration = await registerServiceWorker()
    await registration?.update()
    // Cover a worker that finished installing before the event listener ran.
    if (registration?.waiting && navigator.serviceWorker.controller) {
      offerUpdate(registration.waiting)
    }
  } catch (error) {
    // A failed check is normal on a flaky network; the next focus retries.
    console.warn('Clara could not check for a new version.', error)
  }
}

/** Ask the waiting worker to activate, then reload onto the new build. */
export async function applyUpdate(): Promise<void> {
  if (snapshot.status === 'applying') return
  setSnapshot({ status: 'applying', dismissed: snapshot.dismissed })

  const registration = await registerServiceWorker()
  const waiting = registration?.waiting
  if (!waiting) {
    reloadPage()
    return
  }

  navigator.serviceWorker.addEventListener('controllerchange', reloadPage, { once: true })
  waiting.postMessage({ type: 'SKIP_WAITING' })
  // iOS can drop `controllerchange` on a page that was already open. The
  // waiting worker is active by then, so a reload still lands on the new build.
  window.setTimeout(reloadPage, RELOAD_FALLBACK_MS)
}

export function dismissUpdate(): void {
  if (snapshot.status !== 'available') return
  setSnapshot({ status: 'available', dismissed: true })
}

function installTriggers() {
  const check = (force: boolean) => void checkForUpdate({ force })

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') check(true)
  })
  // Standalone iOS apps often resume without a focus event, so both fire.
  window.addEventListener('focus', () => check(true))
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) check(true)
  })
}

/** Registers the worker and wires the update checks. Safe to call twice. */
export function startServiceWorker(): void {
  if (started) return
  started = true
  // The desktop shell has no service worker; its updater owns updates.
  if (isDesktop) return
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
  // The dev server serves no worker, so there is nothing to register or update.
  if (!import.meta.env.PROD) return

  installTriggers()
  void checkForUpdate({ force: false })
}

/**
 * Last-resort recovery that does not require deleting the home-screen icon:
 * drop the registration and every cache, then start over from the network.
 */
export async function clearCachedAppData(): Promise<void> {
  try {
    const registration = await navigator.serviceWorker.getRegistration()
    await registration?.unregister()
    if ('caches' in window) {
      const keys = await caches.keys()
      await Promise.all(keys.map((key) => caches.delete(key)))
    }
  } catch (error) {
    console.warn('Clara could not clear its cached data.', error)
  }
  reloadPage()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function getSnapshot() {
  return snapshot
}

export function usePwaUpdate(): UpdateSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
