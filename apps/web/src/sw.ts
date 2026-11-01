/// <reference lib="webworker" />
import { clientsClaim } from 'workbox-core'
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
    }),
    { denylist: [/^\/api\//, /^\/oc\//] }
  )
)

const appShell = createHandlerBoundToURL('index.html')

setCatchHandler(async (options) => {
  if (options.request.mode === 'navigate') return appShell(options)
  return Response.error()
})

// `registerType: 'autoUpdate'` for now: activate immediately and take over open
// pages, exactly like the generated worker this replaces.
self.skipWaiting()
clientsClaim()
