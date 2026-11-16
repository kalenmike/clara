# Desktop app

## Summary

Clara runs as a native desktop app as well as a web PWA: the same web client in
a Tauri window, so projects, sessions, chat, approvals, and settings behave the
same. It is a second build target, not a replacement — the web deploy keeps its
service worker and ships unchanged. See [install.md](install.md).

The app also bundles the **adapter host**, a loopback sidecar that runs adapter
installs on this computer, on an SSH host, or in a local Docker container, using
the laptop's SSH agent and Docker socket so a hosted hub needs neither. The same
window carries the hub panel at `/hub` and Clara Lab at `/lab`, both over the
paired hub's bridge; the app runs neither service.

## User flow

1. Run the one-line installer, download a desktop release installer, or build
   from the checkout. The installer adds the desktop app on GUI hosts.
2. Launch Clara. The window opens on the same connect screen as the web client.
3. Paste a browser pairing code from the hub panel (or from `clara pair`) and
   connect.
4. Use Clara as usual: browse projects, start and steer sessions, answer
   approvals, and read usage. A message link opens in the system browser.
5. Run `clara desktop install` to update; Settings → App reports the version.
6. Open **Hub** and use **Harness → Pair Harness** to install an adapter on
   **This computer**, an **SSH host**, or a local **Docker container**. A
   `clara://adapter?code=…` link opens the same flow; see
   [harness-adapters.md](harness-adapters.md).
7. Open **Hub** from the connected app to use the hub panel in this window over
   the encrypted connection, without opening its loopback page.
8. Open **Clara Lab** from the sidebar to preview packages and drive a run by
   hand. It needs a lab service on the engine host and reaches it through the
   hub bridge, so hub and engine can both be remote.

## Core business rules

1. One codebase, two artifacts. The web build writes `dist` with the service
   worker and manifest; the desktop build writes `dist-desktop` without them, so
   a native build cannot leak into a web deploy. The lab route is desktop-only:
   the web build omits it and Vite stubs the lab modules.
2. The app connects through the same hub and the same E2EE WebSocket as a
   browser. Its endpoint comes from the pairing payload, so relay and local-only
   codes both work without a desktop-specific URL.
3. Pairing, drafts, layout, theme, and settings live in the webview's storage and
   belong to the installation; removing the app removes them.
4. Links are contained. Only `http`, `https`, and `mailto` leave the app, new
   windows are denied, and the window is served with the same CSP as the
   deployed web headers, so no remote page is trusted inside the app.
5. A local hub can return on a different port after a conflict. The shell reads
   the shared runtime file and exposes it over Tauri IPC, and the client
   refreshes its stored local URL on boot and reconnect. Relay pairings keep
   their stored relay URL.
6. The adapter host is a second sidecar. The shell spawns it with a per-launch
   bearer token, gives the webview only the bound loopback port, and kills it on
   exit. It validates harness kind, pairing code, target, and manifest, verifies
   the installer hash on the target, and never runs arbitrary commands; there is
   no password prompt, so the SSH key must be in the agent or keychain.
7. `clara://` is registered only for adapter links; the window is focused when
   one arrives, and a link received before the webview is ready is stored.
8. The app is a client, not a hub host. It never starts the hub service, a panel
   listener, or a relay. `/hub` uses the same E2EE session as chat and the typed
   `/v1/hub-panel` bridge, holding a panel session token but neither the served
   panel's HttpOnly cookie nor harness credentials. The bundled panel disables
   the controls that would cut its own connection and keeps the rest; see
   [panel/index.md](panel/index.md).
9. The lab is a route, not a sidecar. `/lab` renders `@clara/lab` and calls the
   hub bridge under `/v1/lab`. The app runs no lab process and holds no engine
   token; the lab service lives next to the engine. See
   [orchestration/lab.md](orchestration/lab.md).
10. Notifications are native. The shell registers `tauri-plugin-notification`;
    Web Audio keeps the per-state sounds, and a click focuses the window and
    opens the session. Web Push is not part of the app.

## Edge cases

- A build host without Rust or the platform WebView development packages cannot
  produce an installer. The web build and deploy are unaffected.
- The Docker builder targets Debian 12 and produces Linux bundles only; macOS
  and Windows installers need their own hosts. If AppImage bundling fails,
  `--bundles deb,rpm` avoids it. The Linux install script refuses a build
  without the adapter-host sidecar.
- Installers are unsigned, so the operating system may warn on first launch.
- There is no service worker, so the PWA install prompt, update banner, and
  cache-recovery action do not appear; Settings reports updates as installed
  with the app. Web Push needs a worker, so that row is hidden. Native
  notifications still alert and hold phone pushes while the window runs.
- The QR camera path depends on the webview exposing a camera; pasting the code
  always works. WebCrypto must be available, and pairing fails rather than
  silently degrading outside a secure context.
- A remote hub with no owner cannot be set up from `/hub`, because it starts no
  transport until the owner exists; create the owner on the hub first.
- A panel session can expire while chat stays connected; the panel asks for
  owner credentials again, and a hub without a panel reports `/hub` unavailable.
- Clara Lab reports the lab service unavailable when the hub cannot reach
  `CLARA_LAB_URL` or the shared token differs. A bookmarked `/lab` opened in a
  browser or PWA shows nothing, because the route is not registered there.

## Out of scope

- Signed and notarized installers and an auto-updater.
- `clara://` browser-pairing deep links and single-instance forwarding.
- Running the hub service, a panel listener, or a relay inside the app.
- Running the lab service in the app or as a bundled sidecar.
- Window-state persistence, tray behavior, and mobile targets.

## Known gaps

- The update surface is a status text until the native updater replaces it.
- Desktop notifications use the platform service: Windows reports a click only
  while the toast is visible, and macOS may use the deprecated notification path.

## Technical appendix

<details>
<summary>Build wiring and code locations</summary>

- `apps/desktop` owns the shell, Tauri configuration, and committed icons. It
  has no `build` script, so `pnpm build` stays a web/Node build. Build, Docker,
  release, and install commands are in [../development.md](../development.md).
  The release workflow runs one platform per host; artifacts include
  `clara-desktop` and the `clara-adapter-host` sidecar. The registry maps DMG,
  AppImage, and NSIS installers onto `desktop` artifacts.
- Vite's `desktop` mode disables `vite-plugin-pwa`, sets
  `build.outDir = dist-desktop`, and defines `CLARA_DESKTOP`; the web build is
  the default. `apps/web/scripts/check-bundle.mjs` asserts the split: `sw.js`
  and the manifest only in the web artifact, no harness SDK symbols, no chunk
  over budget, lab markers only in the desktop artifact.
- The window is created in Rust so navigation can be intercepted; CSP, window
  size, frontend path, and bundle identifier live in `tauri.conf.json`. The
  shell also registers `tauri-plugin-notification` with `notification:default`
  and a `focus_main_window` command; the identifier is `com.kalenmichael.clara`,
  and changing it resets the webview's stored pairing.
- The shell exposes `hub_runtime` through `withGlobalTauri`; the notification
  plugin exposes `window.__TAURI__.notification`, and
  `apps/web/src/lib/desktop-runtime.ts` asks for the live local `wsUrl` on boot
  and reconnect.
- `/hub` renders `@clara/panel` and calls `/v1/hub-panel`; the bridge adds no
  listener. `/lab` renders `@clara/lab` and calls `/v1/lab`, which forwards to
  the lab service's `/api/*`. Both routes are registered only when
  `CLARA_DESKTOP` is set.
- The adapter host lives in `apps/desktop/host` (`@clara/desktop-host`) and
  reuses `@clara/adapter-install`. The bundled panel supplies it through
  `PanelRuntimeProvider`, so the Harness view issues the pairing and runs the
  install; the hub never runs an install. The shell's `adapter_host_runtime` and
  `adapter_take_link` commands are the only bridge.
- Related: [hub service](hub-service.md), [harness adapters](harness-adapters.md),
  [panel](panel/index.md), [lab](orchestration/lab.md), [install](install.md).

</details>
