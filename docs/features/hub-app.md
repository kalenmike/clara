# Hub app

## Summary

The Clara Hub app is a native Tauri shell that runs the hub service and opens
the authenticated panel from the system tray. The hub service is a single Bun
executable with the panel embedded; the Tauri window is only a viewer for the
loopback panel. The chat client is a separate desktop app, described in
[desktop.md](desktop.md).

The app is an alternative to running the hub with Docker or the Node CLI. The
hub data model, pairing, relay, panel, and adapters are unchanged.

## User flow

1. Launch Clara Hub. The tray icon appears and the sidecar starts.
2. On first run the panel opens on its setup screen. Use **Copy setup token**
   from the tray, choose the superadmin password, and create a browser pairing
   code.
3. Pair a client: the web PWA, the desktop client, or a harness adapter.
4. Use **Open panel** from the tray at any time. Closing the panel window hides
   it; the hub keeps running.
5. Use **Quit** to stop the hub. The sidecar checkpoints SQLite and exits.
6. Install a newer app to update the sidecar and panel together. There is no
   in-app updater yet.

## Core business rules

1. One sidecar, one process. The Tauri shell starts `clara-server`, waits for
   the runtime file, and opens the panel. It does not embed a second server.
2. The panel is a loopback HTTP page, not a bundled Tauri frontend. It keeps its
   Host/Origin checks and never receives Tauri IPC. Only `http` loopback
   navigation stays in the window; external links open in the system browser.
3. Ports are discovered, not hardcoded.
   - The panel port prefers the previous run's port and falls back to an
     ephemeral port when it is busy.
   - The local WS/API port prefers `CLARA_LOCAL_PORT`, then an explicit
     `server.json` value, then the previous runtime port, then `8788`, then an
     ephemeral port.
   - The auto-selected local port is **not** written to `server.json`. It lives
     in the runtime file.
   - Docker keeps fixed container ports because pairing links need the published
     host port.
4. The runtime file is the local discovery contract. The hub writes
   `<runtime>/runtime.json` with the actual ports, PID, paths, and version. The
   CLI, MCP, hub shell, and desktop client read it. Remote relay clients do not.
5. A runtime lock makes one hub own a data directory. A second launch prints the
   running endpoints and exits instead of opening the same database.
6. The local port is stable in the common case. When a conflict moves it, only
   local clients and adapters are affected. Relay clients keep working. The
   desktop client refreshes its local endpoint through Tauri IPC and reconnects
   without re-pairing.
7. The sidecar shuts down on `SIGINT`, `SIGTERM`, `shutdown` on stdin, or stdin
   EOF. The tray Quit uses the stdin path, waits briefly, then kills the child.
8. The panel assets are embedded in the sidecar and extracted once per build to
   the app cache. The shipped sidecar is one executable.

## Edge cases

- **Panel port busy**: bind an ephemeral port. The hub app follows the runtime
  file, so the user never types the port.
- **Local port busy**: bind an ephemeral port and publish it. Existing local
  pairings may need a new pairing; relay pairings do not.
- **Existing hub**: the runtime lock refuses a second hub. The tray app's single
  instance focuses the existing app.
- **Stale runtime file**: a dead PID is ignored and the lock is cleared.
- **Sidecar exits**: the tray shows an error dialog and points at the hub log.
- **Panel build missing**: the sidecar build fails before Tauri bundles.
- **No panel**: `--no-panel` leaves the tray without a window; the app is not
  useful for normal users.
- **macOS Cmd+Q**: exits the app and stops the sidecar. Closing the panel window
  only hides it.
- **Linux tray**: needs libayatana-appindicator at runtime. Installers are
  unsigned unless the release pipeline signs them.
- **Orchestration**: the desktop app cannot start the local orchestrator because
  it needs the Node orchestrator and better-sqlite3. Use the orchestrator
  container or the CLI.

## Out of scope

- The chat client desktop app; see [desktop.md](desktop.md).
- Signed and notarized installers, an auto-updater, and a release pipeline.
- Running the orchestrator inside the hub app.
- Serving the web client from the hub app. The web PWA and the web container
  remain separate.

## Known gaps

- The tray menu has no log-folder shortcut.
- Native notifications for sidecar failures are limited to a dialog.
- Cloudflare deployment requires the build flag; the relay artifacts are then
  embedded in the sidecar.

## Technical appendix

<details>
<summary>Build wiring and code locations</summary>

- `apps/hub/desktop` owns the Tauri shell and the sidecar build script.
- `pnpm hub:sidecar` builds the panel, embeds it, and compiles the Bun sidecar.
  `pnpm hub:dev` and `pnpm hub:build` run the sidecar build first. The hub app is
  outside `pnpm build`.
- `pnpm hub:build:docker` builds the Linux bundles in Debian 12 with Rust, Node,
  Bun, and the WebKitGTK prerequisites, then extracts them to `dist/hub`. The
  image runs the sidecar build before Tauri, passes the version stamp because
  `.git` is outside the context, and keeps Cargo, Tauri tool, and target
  directories in cache mounts. `--bundles`, `--platform`, `--output`, `--base`,
  `--no-cache`, and `--cloudflare` are available; like the desktop build, it
  cannot produce macOS or Windows installers.
- `apps/hub/desktop/src/entry.ts` extracts the embedded panel and calls
  `@clara/hub-server/main`. The sidecar uses the `bun` export condition of
  `@clara/sqlite`, so `bun:sqlite` replaces better-sqlite3.
- `apps/hub/desktop/scripts/build-sidecar.mjs` maps the Rust target triple to a
  Bun target. `TAURI_ENV_TARGET_TRIPLE` overrides the host triple. Relay files
  are embedded when `ENABLE_CLOUDFLARE_DEPLOYMENT` is on.
- Runtime file: `CLARA_RUNTIME_FILE`, or the platform path from
  `packages/runtime-state`. The hub writes it; the CLI, MCP, hub shell, and
  desktop shell read it.
- Hub app environment: `CLARA_CONFIG_DIR`, `CLARA_DATA_DIR`, `CLARA_CACHE_DIR`,
  loopback bind hosts, and `CLARA_CONTROL_STDIN=1`. The sidecar chooses the
  ports.
- Docker: `infra/docker/server.Dockerfile` builds the Bun sidecar; the Node
  fallback is `server-node.Dockerfile`. Compose keeps the fixed `8788`/`8790`
  mappings and uses `clara-server health` for the healthcheck.
- See [development.md](../development.md) for build commands and
  [panel.md](panel.md) for the panel surface.

</details>
