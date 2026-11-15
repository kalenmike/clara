# Install and updates

## Summary

Clara installs as a PWA on desktop and iPhone and keeps itself current without
asking anyone to delete and re-add the home-screen icon. The same client can be
served by the local stack instead of Cloudflare Pages. A native desktop app is
the other build target; see [desktop.md](desktop.md).

## User flow

1. Open Clara over HTTPS and choose Add to Home Screen (iOS) or Install
   (desktop). The app opens standalone with its own icon and theme color.
2. On every launch, and whenever Clara returns to the foreground, it asks the
   browser whether the service worker changed.
3. When a deploy is newer, a banner appears above the content: **Update** or
   **Later**. One build is offered once; a rebuild of the same code is not an
   update.
4. **Update** asks the new worker to take over, waits until it controls the
   page, and only then reloads onto the new build.
5. **Later** keeps the current build for this session. Closing every Clara
   window installs the update for the next launch.
6. Settings → App shows the surface label, running version, and build, reports
   whether an update is ready, and offers **Clear cached app data**.
7. Before pairing, and on every boot splash, a footer shows the surface label,
   app version, the wire protocol version, and a reload control. On the web the
   control unregisters the worker, drops every cache, and reloads; on desktop it
   reloads the bundled app.
8. Offline, a navigation falls back to the cached app shell instead of failing.

### Self-hosted web client

Cloudflare Pages is optional: `clara start web --build` serves the same built
bundle on `http://127.0.0.1:8080`. Service lifecycle and ports belong to
[hub-service.md](hub-service.md); `clara rebuild` restarts the local web client
with a fresh build.

Local pairing works from that address or an SSH tunnel, and local codes print a
link to it. A remote HTTPS page cannot open a `ws://` socket, so remote browsers
need a relay pairing: set **Web URL** in the hub panel for the deployment
(`CLARA_PAIRING_BASE_URL` overrides it), and set `VITE_CLARA_WS_URL` only when
the browser must use a different relay endpoint than the hub. Pairing rules live
in [connection.md](connection.md).

## Core business rules

1. App documents come from the network first and fall back to the cached shell
   after three seconds or when the device is offline. The cached shell is never
   the preferred answer while the network works, and only app documents are
   cached: API reads, streams, and push payloads never are.
2. The worker script and app shell are never HTTP-cached, so a deploy is visible
   on the next check rather than hours later. Every emitted script chunk is
   precached, so an installed app opens a screen offline even if it was never
   opened before.
3. An update is never applied under a running page. The new worker waits until
   someone taps **Update**, or until every Clara window has closed. A first
   install is not an update: a new worker prompts only when a worker already
   controls the page.
4. A waiting worker is offered only when it reports a different, newer build. A
   rebuild of the same commit, a worker built before the page, a same-build copy,
   and a build applied on this page in the last five minutes are ignored.
5. The page never reloads on a timer. It reloads after the waiting worker takes
   control; otherwise the banner stays for another attempt. The footer reload
   control and **Clear cached app data** are the only unasked resets, and only
   they clear the worker and caches before reloading.

## Edge cases

- **Offline launch**: the cached shell loads and the router opens the last
  route; a route that was never visited still gets the shell.
- **Flaky network**: a navigation waits up to three seconds before the cached
  shell is used.
- **Update ignored**: the banner stays dismissed until the app is relaunched; a
  newer deploy asks again.
- **Rebuild of the same commit**: the worker is byte-different but not a new
  version, so it is ignored and installs on the next launch.
- **Older deploy served out of order**: a waiting worker built before the page
  is ignored, so the app never offers a downgrade.
- **Two Clara windows**: the window that applies the update reloads; the others
  drop the offer and pick up the new build on their next navigation.
- **Deploy between page load and navigation**: the controlling worker answers
  from the precache of the build the page came from, so navigation keeps
  working; a plain browser tab without worker control recovers with one reload.
- **Install interrupted**: closing the app mid-install or deploying during it
  discards the install or fails it quietly, and the next check retries.
- **Wedged app**: Settings → App or the footer reload control clears the worker
  and every cache, then reloads from the network; pairing, settings, and drafts
  are untouched. Push may need subscribing again, and the notifications card
  offers it.
- **Large shared cookie jar**: browsers share cookies across every port on the
  same host, so a `127.0.0.1` jar can grow past the header buffer; open
  `http://localhost:8080` for a separate jar. A browser tab does everything
  except standalone display and Web Push on iOS.

## Out of scope

- Silent updates that reload the app without asking.
- Version pinning, staged rollouts, or rollback to an older build from the app.
- Offline writes, background sync, or queued prompts.

## Known gaps

- A client stuck on a worker cached before the reload control shipped cannot be
  repaired remotely. It recovers when its worker script expires (at most four
  hours after a deploy) and the next launch installs the new worker.
- The worker is a classic script, so `importScripts` keeps working and iOS does
  not need module service worker support.

## Technical appendix

<details>
<summary>Routes, data, and references</summary>

- Worker: `apps/web/src/sw.ts` (`strategies: 'injectManifest'`,
  `rollupFormat: 'iife'`). Navigations match `request.mode === 'navigate'`, which
  keeps `/api` out of the cache.
- Registration and update state: `apps/web/src/features/pwa/update-store.ts`
  (`updateViaCache: 'none'`); checks run on `visibilitychange`, `focus`, and a
  restored `pageshow`.
- Build identity: `__CLARA_BUILD_ID__` and `__CLARA_BUILD_AT__` are defined in
  both the app and the worker (`apps/web/vite.config.ts`). A clean checkout uses
  its commit; a dirty tree or a checkout without git uses the build time.
- Offer rules: `apps/web/src/features/pwa/update-check.ts` (`shouldOfferUpdate`,
  `isRecentlyApplied`, `dueForUpdateCheck`). Handover posts `SKIP_WAITING` over a
  `MessageChannel` and waits for `controllerchange` before reloading
  (`waitForActivation`, ten-second bound).
- Banner: `apps/web/src/components/pwa/update-banner.tsx`. Footer:
  `apps/web/src/components/pwa/app-footer.tsx`, with `reloadApp` in
  `apps/web/src/features/updates/app-update.ts` picking the surface reset.
- Reset action and build stamp: `apps/web/src/components/settings/app-card.tsx`.
  Status bar: `apps/web/src/components/layout/app-status-bar.tsx`.
- Cache headers: `apps/web/public/_headers` revalidates `/sw.js`,
  `/index.html`, and `/manifest.webmanifest`. Push handlers:
  `apps/web/public/push-sw.js`.
- Route chunks: `apps/web/src/router.tsx` lazy-loads every screen; the build
  fails a chunk that carries harness SDK markers or exceeds the size budget.
- Related: [capabilities](capabilities.md), [desktop](desktop.md),
  [hub service](hub-service.md), [connection](connection.md).

</details>
