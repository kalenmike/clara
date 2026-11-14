import { useSyncExternalStore } from 'react'
import {
  dueForUpdateCheck,
  isRecentlyApplied,
  isUpdateAvailable,
  shouldOfferUpdate,
  type AppliedBuild,
  type WorkerBuild,
} from '@/features/pwa/update-check'
import { claraBuildId, claraBuiltAt } from '@/lib/build-info'
import { isDesktop } from '@/lib/runtime'

export type UpdateStatus = 'idle' | 'available' | 'applying'

export type UpdateSnapshot = {
  status: UpdateStatus
  /** Set when the user chose "Later"; a newer worker asks again. */
  dismissed: boolean
}

const IDLE: UpdateSnapshot = { status: 'idle', dismissed: false }
const WORKER_URL = '/sw.js'
/** How long a waiting worker gets to take control after `SKIP_WAITING`. */
const ACTIVATION_TIMEOUT_MS = 10_000
/** How long a build applied here is ignored if the browser offers it again. */
const APPLIED_KEY = 'clara.pwa.appliedBuild'
/** A waiting worker that predates the build message never answers. */
const WORKER_BUILD_TIMEOUT_MS = 2_000

/** The build this page is running; the service worker reports the same values. */
const RUNNING_BUILD: WorkerBuild = { id: claraBuildId, at: claraBuiltAt }

let snapshot: UpdateSnapshot = IDLE
const listeners = new Set<() => void>()
let registrationRequest: Promise<ServiceWorkerRegistration | null> | null = null
let started = false
let lastCheckAt = 0
let reloading = false
let watchingController = false
/** A waiting worker already considered, so it is not read twice. */
let considered: ServiceWorker | null = null
/** Build of the waiting worker that produced the current offer. */
let pending: { worker: ServiceWorker; build: WorkerBuild | null } | null = null

function setSnapshot(next: UpdateSnapshot) {
  snapshot = next
  for (const listener of listeners) listener()
}

/** Reads the live state: awaiting a worker message can change it after a check. */
function isApplying() {
  return snapshot.status === 'applying'
}

function reloadPage() {
  if (reloading) return
  reloading = true
  window.location.reload()
}

function readApplied(): AppliedBuild | null {
  try {
    const raw = sessionStorage.getItem(APPLIED_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<AppliedBuild>
    return typeof parsed.id === 'string' && typeof parsed.at === 'number'
      ? { id: parsed.id, at: parsed.at }
      : null
  } catch {
    return null
  }
}

function rememberApplied(build: WorkerBuild | null) {
  if (!build) return
  try {
    sessionStorage.setItem(APPLIED_KEY, JSON.stringify({ id: build.id, at: Date.now() }))
  } catch {
    // Storage can be unavailable; the offer still works without the guard.
  }
}

function clearApplied() {
  try {
    sessionStorage.removeItem(APPLIED_KEY)
  } catch {
    // Storage can be unavailable; there is nothing to clear.
  }
}

/** Ask a waiting worker which build it is. Null when it predates the message. */
function readWorkerBuild(worker: ServiceWorker): Promise<WorkerBuild | null> {
  return new Promise((resolve) => {
    const channel = new MessageChannel()
    const timer = window.setTimeout(() => finish(null), WORKER_BUILD_TIMEOUT_MS)

    function finish(value: WorkerBuild | null) {
      window.clearTimeout(timer)
      channel.port1.onmessage = null
      channel.port1.close()
      resolve(value)
    }

    channel.port1.onmessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; buildId?: unknown; builtAt?: unknown } | null
      if (
        data?.type !== 'CLARA_BUILD' ||
        typeof data.buildId !== 'string' ||
        typeof data.builtAt !== 'string'
      ) {
        finish(null)
        return
      }
      finish({ id: data.buildId, at: data.builtAt })
    }

    try {
      worker.postMessage({ type: 'CLARA_BUILD' }, [channel.port2])
    } catch {
      finish(null)
    }
  })
}

/**
 * Offer a waiting worker only when it is a different, newer build. A rebuild of
 * the same commit (the browser can report it as waiting) and a worker built
 * before this page are not updates.
 */
async function considerUpdate(worker: ServiceWorker | null) {
  if (!worker) return
  if (isApplying()) return
  if (worker === considered) return
  considered = worker

  const build = await readWorkerBuild(worker)
  pending = { worker, build }
  // The worker can activate while it is answering the build message.
  if (worker.state !== 'installed') return
  if (isRecentlyApplied({ applied: readApplied(), buildId: build?.id ?? null, now: Date.now() })) {
    return
  }
  if (!shouldOfferUpdate({ running: RUNNING_BUILD, waiting: build })) return
  if (isApplying()) return

  setSnapshot({ status: 'available', dismissed: false })
}

function considerInstalled(worker: ServiceWorker | null) {
  if (!worker || worker.state !== 'installed') return
  if (
    !isUpdateAvailable({ waiting: true, controlled: Boolean(navigator.serviceWorker.controller) })
  ) {
    return
  }
  void considerUpdate(worker)
}

/** Resolve true once the waiting worker controls this page. */
function waitForActivation(
  registration: ServiceWorkerRegistration,
  worker: ServiceWorker
): Promise<boolean> {
  const controls = () =>
    registration.active === worker ||
    worker.state === 'activated' ||
    navigator.serviceWorker.controller === worker

  if (controls()) return Promise.resolve(true)

  return new Promise((resolve) => {
    let settled = false

    const finish = (value: boolean) => {
      if (settled) return
      settled = true
      worker.removeEventListener('statechange', onStateChange)
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange)
      window.clearTimeout(timer)
      resolve(value)
    }

    // A worker that never activates must not reload this page: the reload would
    // land on the build that is already running and ask again.
    const onStateChange = () => {
      if (worker.state === 'activated') finish(true)
      else if (worker.state === 'redundant') finish(false)
    }
    const onControllerChange = () => {
      if (controls()) finish(true)
    }

    const timer = window.setTimeout(() => finish(controls()), ACTIVATION_TIMEOUT_MS)
    worker.addEventListener('statechange', onStateChange)
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange)
  })
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
  // The worker can already be waiting when this page starts: the user chose
  // "Later" on an earlier launch, or a deploy landed while the app was closed.
  considerInstalled(registration.waiting)
  // `register()` can resolve after an update was already found, so look at the
  // installing worker too instead of waiting for another `updatefound`.
  if (registration.installing) watchInstalling(registration.installing, considerInstalled)

  registration.addEventListener('updatefound', () => {
    if (registration.installing) watchInstalling(registration.installing, considerInstalled)
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

/** Another window applied the update; keep this one from offering it again. */
function watchController() {
  if (watchingController) return
  watchingController = true
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (snapshot.status === 'applying') {
      reloadPage()
      return
    }
    if (snapshot.status !== 'available') return
    // This page still runs the previous build, but the worker it was offering
    // has taken over. Do not keep the offer on screen; the next navigation
    // picks up the new build.
    setSnapshot(IDLE)
  })
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
    considerInstalled(registration?.waiting ?? null)
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
  if (!registration || !waiting) {
    // Nothing is waiting: the update was already applied or was discarded.
    reloadPage()
    return
  }

  const build = pending?.worker === waiting ? pending.build : await readWorkerBuild(waiting)
  rememberApplied(build)
  waiting.postMessage({ type: 'SKIP_WAITING' })

  if (await waitForActivation(registration, waiting)) {
    reloadPage()
    return
  }

  // The worker never took control. Keep the offer instead of reloading onto the
  // build that is already running, which would show the same banner again.
  clearApplied()
  considered = null
  setSnapshot({ status: 'available', dismissed: false })
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

  watchController()
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
