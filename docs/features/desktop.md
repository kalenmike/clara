# Desktop app

## Summary

Clara can run as a native desktop app as well as a web PWA. The desktop app is
the same web client in a Tauri window, so projects, sessions, chat, approvals,
and settings behave the same. It is a second build target, not a replacement:
the web deploy keeps its service worker and continues to ship unchanged.

## User flow

1. Build the app for the host platform, or open an installer produced from the
   checkout.
2. Launch Clara. The window opens on the same connect screen as the web client.
3. Paste a browser pairing code from the hub panel (or from `pnpm clara pair`)
   and connect.
4. Use Clara as usual: browse projects, start and steer sessions, answer
   approvals, and read usage.
5. Click a link in a message; it opens in the system browser instead of
   replacing the app.
6. Install a newer build to update. There is no in-app updater yet.
7. Settings → App identifies the desktop app and shows the same version and
   build stamp as the web client.

## Core business rules

1. One codebase, two artifacts. The web build writes `dist` with the service
   worker and manifest; the desktop build writes `dist-desktop` without them,
   so a native build can never leak into a web deploy.
2. The desktop app connects through the same hub and the same E2EE WebSocket as
   a browser. Its endpoint comes from the pairing payload, so remote relay and
   local-only codes both work without a desktop-specific URL.
3. Pairing, drafts, layout, theme, and settings live in the webview's
   IndexedDB/localStorage. They belong to the app installation; removing the
   app removes them.
4. Links are contained. Only `http`, `https`, and `mailto` leave the app, and
   new windows are denied. Other schemes never reach the system.
5. The window is served with the same CSP as the deployed web headers. No
   remote page is trusted inside the app.

## Edge cases

- A build host without Rust or the platform WebView development packages cannot
  produce an installer. The web build and deploy are unaffected.
- Installers are unsigned, so the operating system may warn on first launch.
- The desktop app has no service worker, so the PWA install prompt, update
  banner, and cache-recovery action do not appear. Settings reports updates as
  installed with the app.
- Web Push needs a service worker, so the push switch stays hidden. Inbox
  attention is limited to the running window until native notifications land.
- Pairing links are ordinary web URLs. On desktop the code is pasted; a
  `clara://` deep link is not registered yet.
- The QR camera path depends on the platform webview exposing a camera.
  Pasting the code always works.
- WebCrypto must be available for device-key pairing. If a platform webview
  ever loads the app outside a secure context, pairing fails instead of
  silently degrading.
- Several app windows can run at once. Each opens its own hub connection from
  the same paired device.

## Out of scope

- Signed and notarized installers, an auto-updater, and a release pipeline.
- Native notifications and notification-click routing.
- `clara://` deep-link pairing and single-instance forwarding.
- Window-state persistence, tray behavior, and mobile targets.

## Known gaps

- The update surface is a status text until the native updater replaces it.
- Native notifications and deep links are the next desktop changes; the web
  notification module and pairing capture are the intended seams.

## Technical appendix

<details>
<summary>Build wiring and code locations</summary>

- `apps/desktop` owns the shell, the Tauri configuration, and the committed
  icons. It has no `build` script, so `pnpm build` stays a web/Node build.
- `pnpm desktop:dev` runs the Vite dev server in desktop mode and the Tauri
  window; `pnpm desktop:build` bundles installers for the host platform;
  `pnpm desktop:build:app` produces the binary without installers.
- Vite's `desktop` mode disables `vite-plugin-pwa`, sets
  `build.outDir = dist-desktop`, and defines `CLARA_DESKTOP`. The web build is
  the default and keeps the PWA worker and manifest.
- `apps/web/scripts/check-bundle.mjs` asserts the split on every build: the web
  artifact must contain `sw.js` and the manifest, the desktop artifact must not.
- The window is created in Rust so navigation can be intercepted. The CSP,
  window size, frontend path, and bundle identifier live in `tauri.conf.json`.
  The bundle identifier is `com.kalenmichael.clara`; changing it resets the
  webview's stored pairing.
- Update UI is read through `apps/web/src/features/updates`; the web branch
  keeps using the service worker. Notifications stay behind
  `features/notifications/notifier.ts`, and pairing capture accepts an explicit
  URL, so both can gain desktop branches without touching their callers.
- See [install.md](install.md) for the web/PWA lifecycle and
  [../architecture/overview.md](../architecture/overview.md) for the connection
  model.

</details>
