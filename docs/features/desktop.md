# Desktop app

## Summary

Clara can run as a native desktop app as well as a web PWA. The desktop app is
the same web client in a Tauri window, so projects, sessions, chat, approvals,
and settings behave the same. It is a second build target, not a replacement:
the web deploy keeps its service worker and continues to ship unchanged. The
app is built on its host, or for Linux in a container that extracts the bundles
into the checkout.

The desktop app also bundles the **adapter host**: a loopback sidecar that runs
adapter installs on this computer, on an SSH host, or in a local Docker
container. It uses the laptop's SSH agent and Docker socket, so a hosted hub
never needs either. The browser keeps the copy-command path.

The same window carries the hub panel at `/hub` for the hub it is paired with.
It is the shared `@clara/panel` UI reached over the existing E2EE session, so
the operator can administer a remote hub without opening its loopback page. The
app does not run the hub service, a panel listener, or a second hub process; the
adapter host remains its only bundled service.

## User flow

1. Build the app for the host platform, or open an installer produced from the
   checkout.
2. Launch Clara. The window opens on the same connect screen as the web client.
3. Paste a browser pairing code from the hub panel (or from `clara pair`)
   and connect.
4. Use Clara as usual: browse projects, start and steer sessions, answer
   approvals, and read usage.
5. Click a link in a message; it opens in the system browser instead of
   replacing the app.
6. Install a newer build to update. There is no in-app updater yet.
7. Settings → App identifies the desktop app and shows the same version and
   build stamp as the web client.
8. Open **Hub** and use **Harness → Pair Harness** to install an adapter on
   **This computer**, an **SSH host** from `~/.ssh/config`, or a local **Docker
   container**. A `clara://adapter?code=…` link opens the same panel flow with
   the code filled in.
9. Open **Hub** from the connected app to use the hub panel in the same window.
   Sign in with the hub owner account. The overview, harness, sessions,
   connections, clients, traffic, activity, and settings views use the paired
   hub's live state over the encrypted connection; no loopback page is opened.

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
6. A local hub can return on a different port after a conflict. The shell reads
   the shared runtime file and exposes it to the webview through Tauri IPC; the
   client refreshes its stored local URL on boot and reconnect. Relay pairings
   keep their stored relay URL.
7. The adapter host is a second sidecar. The shell spawns it with a per-launch
   bearer token, prints only the bound loopback port to the webview, and kills
   it on exit. The host accepts local, SSH, and Docker installs; it validates
   the harness kind, pairing code, target, and manifest, verifies the installer
   hash on the target, and never runs arbitrary commands. There is no password
   prompt: the user's SSH key must be in the agent/keychain.
8. `clara://` is registered only for adapter links. The window is
   focused when one arrives; a link received before the webview is ready is
   stored and read on demand. Other schemes never reach the system.
9. The app is a client, not a hub host. It never starts the hub service, a
   panel listener, or a relay. `/hub` uses the same E2EE session as chat and
   reaches the hub's loopback panel through the typed `/v1/hub-panel` bridge.
   The app holds a panel session bearer token for that connection; it does not
   receive the served panel's HttpOnly cookie or the hub's harness credentials.
10. The bundled panel disables controls that would cut its own connection:
    **Go offline**, the transport switch carrying the session (local or relay),
    and relay target or room edits. Harness setup, device management, monitoring, sync,
    orchestration, and configuration stay available. Adapter setup offers are
    carried out by the app's adapter host, not by the hub service.

## Edge cases

- A build host without Rust or the platform WebView development packages cannot
  produce an installer on the host. The web build and deploy are unaffected.
- The Docker builder targets Debian 12 and produces Linux bundles only. macOS
  and Windows installers need their own hosts. AppImage bundling can still fail
  inside linuxdeploy; narrowing to `--bundles deb,rpm` avoids it.
- Installers are unsigned, so the operating system may warn on first launch.
- The desktop app has no service worker, so the PWA install prompt, update
  banner, and cache-recovery action do not appear. Settings reports updates as
  installed with the app.
- Web Push needs a service worker, so the push switch stays hidden. Inbox
  attention is limited to the running window until native notifications land.
- Pairing links for a browser are ordinary web URLs. Adapter links use
  `clara://adapter?code=…`; the browser pairing flow still uses a pasted code.
- The QR camera path depends on the platform webview exposing a camera.
  Pasting the code always works.
- WebCrypto must be available for device-key pairing. If a platform webview
  ever loads the app outside a secure context, pairing fails instead of
  silently degrading.
- A local port change is repaired from the runtime file without a new pairing.
  A remote client that cannot read the file keeps its relay URL.
- Several app windows can run at once. Each opens its own hub connection from
  the same paired device.
- A remote hub with no owner account cannot be set up from `/hub`. The hub
  starts no transport until the owner exists, so the app cannot connect. Create
  the owner with `CLARA_ADMIN_*` or the headless setup command, then pair the
  app. The bundled panel never renders the local setup form.
- The panel session expires while the app stays connected to chat. The panel
  asks for the owner credentials again; the chat connection is unaffected.
- The hub has no panel because it was built or started with the panel disabled.
  `/hub` reports that the panel is unavailable.
- A control that is disabled in the bundled panel explains why and points at the
  server-served panel on the hub. The app does not silently hide the control.
- The app is offline from the hub. The panel shows the connection failure and
  the last snapshot is not presented as live.

## Out of scope

- Signed and notarized installers, an auto-updater, and a release pipeline.
- Native notifications and notification-click routing.
- `clara://` browser-pairing deep links and single-instance forwarding.
- Running the hub service, a panel listener, or a relay inside the app.
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
- `pnpm desktop:build:docker` builds Linux bundles in Debian 12 with Rust, Node,
  and the WebKitGTK prerequisites, then extracts them to `dist/desktop` with the
  BuildKit local exporter. Cargo, Tauri tool, and target directories live in
  cache mounts. The script passes the version stamp because `.git` is outside
  the context, and sets `NO_STRIP`/`APPIMAGE_EXTRACT_AND_RUN` for linuxdeploy.
  `--bundles`, `--platform`, `--output`, `--base`, and `--no-cache` are
  available; the container cannot produce macOS or Windows installers.
- Vite's `desktop` mode disables `vite-plugin-pwa`, sets
  `build.outDir = dist-desktop`, and defines `CLARA_DESKTOP`. The web build is
  the default and keeps the PWA worker and manifest.
- `apps/web/scripts/check-bundle.mjs` asserts the split on every build: the web
  artifact must contain `sw.js` and the manifest, the desktop artifact must not,
  every emitted chunk is scanned for harness SDK symbols, and no chunk may
  exceed the size budget.
- The window is created in Rust so navigation can be intercepted. The CSP,
  window size, frontend path, and bundle identifier live in `tauri.conf.json`.
  The bundle identifier is `com.kalenmichael.clara`; changing it resets the
  webview's stored pairing.
- Update UI is read through `apps/web/src/features/updates`; the web branch
  keeps using the service worker. Notifications stay behind
  `features/notifications/notifier.ts`, and pairing capture accepts an explicit
  URL, so both can gain desktop branches without touching their callers.
- The shell exposes `hub_runtime` through `withGlobalTauri`. On boot and
  reconnect, `apps/web/src/lib/desktop-runtime.ts` asks for the live local
  `wsUrl` and `connection-provider.tsx` persists it when it changed.
- The bundled panel route is `/hub`. It renders `@clara/panel` from
  `packages/panel` and calls the hub bridge under `/v1/hub-panel` through the
  paired E2EE session. It passes the house capability set that disables **Go
  offline**, the active transport switch (local or relay), and relay target/room
  edits.
  The bridge adds no listener; the app still has no hub-service process.
- The adapter host lives in `apps/desktop/host` (`@clara/desktop-host`). It
  reuses `@clara/adapter-install` from `packages/adapters/install` for planning,
  target discovery, and jobs. The bundled panel supplies it through
  `PanelRuntimeProvider`, so the same Harness view issues the pairing and runs
  the install; the hub never runs an install. A `clara://adapter` link opens
  `/hub#harness` with the one-time code instead of a separate Settings dialog.
  `pnpm --filter @clara/desktop-host run bundle` compiles the Bun sidecar into
  `apps/desktop/src-tauri/binaries/clara-adapter-host-<triple>`; the Tauri
  `externalBin` entry packages it. The shell's `adapter_host_runtime` and
  `adapter_take_link` commands are the only bridge, and
  `apps/web/src/lib/desktop-adapter-host.ts` calls the loopback service with the
  per-launch token. The deep-link plugin registers the `clara` scheme.
- See [install.md](install.md) for the web/PWA lifecycle and
  [../architecture/overview.md](../architecture/overview.md) for the connection
  model.

</details>
