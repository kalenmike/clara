/// <reference lib="webworker" />
import { clientsClaim } from 'workbox-core'
import { ExpirationPlugin } from 'workbox-expiration'
import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
  type PrecacheEntry,
} from 'workbox-precaching'
import { NavigationRoute, registerRoute, setCatchHandler } from 'workbox-routing'
import { NetworkFirst } from 'workbox-strategies'

/** Filled in by vite-plugin-pwa from the build's asset manifest. */
declare let self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<PrecacheEntry | string>
}

/**
 * Push and notification-click handlers stay in a hand-written script: the home
 * agent ships the same behavior and the file is easier to read on its own.
 */
self.importScripts('/push-sw.js')

const DOCUMENT_CACHE = 'clara-documents'
/** A flaky network should fall back to the cached shell quickly. */
const DOCUMENT_TIMEOUT_MS = 3_000

precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()

/**
 * Documents go to the network first. The precached `index.html` is only a
 * handler for failures: an installed PWA can resume for days without a
 * navigation, so serving the precache first would pin it to the build that
 * produced this worker.
 *
 * `request.mode === 'navigate'` is the only safe split: API reads are
 * same-origin GETs too, and they must never enter a cache.
 */
registerRoute(
  new NavigationRoute(
    new NetworkFirst({
      cacheName: DOCUMENT_CACHE,
      networkTimeoutSeconds: DOCUMENT_TIMEOUT_MS,
      // One entry per visited route; a long-lived install should not keep them
      // all, and an old document is only useful for the next few launches.
      plugins: [new ExpirationPlugin({ maxEntries: 25, maxAgeSeconds: 7 * 24 * 60 * 60 })],
    }),
    { denylist: [/^\/api\//, /^\/oc\//] }
  )
)

const appShell = createHandlerBoundToURL('index.html')

setCatchHandler(async (options) => {
  if (options.request.mode === 'navigate') return appShell(options)
  return Response.error()
})

// The update banner asks for this message. Skipping waiting on install would
// swap the worker under a page that is still running the previous build.
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting()
})

// A claimed page receives `controllerchange`, which is what the banner reloads
// on. Without it a new worker activates but waits for every window to close,
// which on an installed iOS app can mean days.
clientsClaim()
