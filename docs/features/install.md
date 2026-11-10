# Install and updates

## Summary

Clara installs as a PWA on desktop and iPhone and keeps itself current without
asking anyone to delete and re-add the home-screen icon.

## User flow

1. Open Clara over HTTPS and choose Add to Home Screen (iOS) or Install
   (desktop). The app opens standalone with its own icon and theme color.
2. On every launch, and whenever Clara returns to the foreground, it asks the
   browser whether the service worker changed.
3. When a deploy is newer, a banner appears above the content: **Update** or
   **Later**.
4. **Update** hands over to the new worker and reloads onto the new build.
5. **Later** keeps the current build for this session. Closing every Clara
   window installs the update for the next launch.
6. Settings → App shows the running version and build, reports whether an
   update is ready, and offers **Clear cached app data**.
7. Offline, a navigation falls back to the cached app shell instead of failing.

## Core business rules

1. App documents come from the network first and fall back to the cached shell
   after three seconds or when the device is offline. The cached shell is never
   the preferred answer while the network works.
2. The worker script and the app shell are never HTTP-cached: every launch
   revalidates them, so a deploy is visible on the next check rather than four
   hours later.
3. An update is never applied under a running page. The new worker waits until
   someone taps Update, or until every Clara window has closed.
4. A first install is not an update. A newly installed worker only prompts when
   a worker already controls the page.
5. API reads, streams, and push payloads never enter a cache. Only app
   documents are cached.

## Edge cases

- **Offline launch**: the cached shell loads and the router opens the last
  route; a route that was never visited still gets the shell.
- **Flaky network**: a navigation waits up to three seconds before the cached
  shell is used.
- **Update ignored**: the banner stays dismissed until the app is relaunched;
  a newer deploy asks again.
- **App closed mid-install**: the install is discarded and retried on the next
  launch.
- **Deploy during install**: a precache entry can 404 on hashed files, the
  install fails quietly, and the next check retries.
- **Wedged app**: Settings → App clears the worker registration and every cache,
  then reloads from the network. Pairing, settings, and drafts are untouched.
- **Notifications after clearing**: the push subscription can be dropped; the
  notifications card offers to subscribe again.
- **Browser tab**: everything works except standalone display and Web Push on
  iOS.

## Out of scope

- Silent updates that reload the app without asking.
- Version pinning, staged rollouts, or rollback to an older build from the app.
- Offline writes, background sync, or queued prompts.

## Known gaps

- A client already stuck on a worker cached before this change cannot be
  repaired remotely. It recovers when its cached worker script expires (at most
  four hours after a deploy) and the next launch installs the new worker.
- The worker is built as a classic script, so `importScripts` keeps working and
  iOS does not need module service worker support.

## Technical appendix

<details>
<summary>Routes, data, and references</summary>

- Worker: `apps/web/src/sw.ts`. Built with `strategies: 'injectManifest'` and
  `rollupFormat: 'iife'`; navigations match by `request.mode === 'navigate'`,
  which keeps `/api` out of the cache.
- Registration and update state: `apps/web/src/features/pwa/update-store.ts`
  (`updateViaCache: 'none'`). Checks run on `visibilitychange`, `focus`, and a
  restored `pageshow`.
- Throttle and offer rules: `apps/web/src/features/pwa/update-check.ts`.
- Banner: `apps/web/src/components/pwa/update-banner.tsx`, rendered under the
  mobile app bar in the app shell.
- Reset action and build stamp: `apps/web/src/components/settings/app-card.tsx`.
- Cache headers: `apps/web/public/_headers` revalidates `/sw.js`,
  `/index.html`, and `/manifest.webmanifest`.
- Push handlers: `apps/web/public/push-sw.js`, loaded with `importScripts`.
- Vite: `apps/web/vite.config.ts` (`registerType: 'prompt'`,
  `injectRegister: false`, `srcDir: 'src'`, `filename: 'sw.ts'`).
- Related: [capabilities](capabilities.md), [notifications](notifications.md).

</details>
