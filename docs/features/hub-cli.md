# Hub CLI

## Summary

The Clara hub is a CLI service. The shipped artifact is a single `clara-server`
Bun executable with the hub service and panel embedded. It runs the local
WebSocket/API listener, the outbound relay client, and the loopback panel from
one process. There is no desktop shell, tray icon, or Tauri window.

The hub CLI is an alternative to running the hub with Docker or a Node install.
The hub data model, pairing, relay, panel, and adapters are unchanged.

The panel remains the first-run and recovery surface. For day-to-day control,
Clara Desktop can render the same panel UI at `/hub` over its paired E2EE
session; the hub neither hosts nor depends on that route.

## User flow

1. Run `clara-server serve`. On first run the hub serves only its loopback
   panel and starts no transports.
2. Open the panel and create the hub owner account, or run
   `clara-server setup --username <name> --password-stdin`.
3. Follow the Setup modal: choose Local only or set up the relay, pair a
   harness, then pair a client. It can be dismissed and resumed from
   **Settings → Setup**.
4. Open Clara on the paired device from the link or QR shown in the modal.
5. Keep the process running under a service manager, container, or terminal.
6. Stop it with `SIGINT` or `SIGTERM`. The process checkpoints SQLite and exits.
7. Update by replacing the executable or container image. The database
   migrations run on startup.

On another machine, pair Clara Desktop and open **Hub** to reach the same panel
through the encrypted tunnel. The loopback panel remains the surface for first
run and recovery.

## Core business rules

1. One process, one hub. `serve` starts the local listener, relay client, and
   panel in the same process. It does not spawn a child server.
2. The panel is a loopback HTTP page. It keeps its Host/Origin checks and
   never receives desktop IPC. There is no native window to host it.
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
   CLI, MCP, and desktop client read it. Remote relay clients do not.
5. A runtime lock makes one hub own a data directory. A second launch prints the
   running endpoints and exits instead of opening the same database.
6. The local port is stable in the common case. When a conflict moves it, only
   local clients and adapters are affected. Relay clients keep working. The
   desktop client refreshes its local endpoint and reconnects without
   re-pairing.
7. The process shuts down on `SIGINT`, `SIGTERM`, `shutdown` on stdin, or stdin
   EOF. `CLARA_CONTROL_STDIN=1` enables the stdin control path.
8. The panel assets are embedded in the Bun executable and extracted once per
   build to the cache directory. The shipped hub binary is one file.
9. The hub issues adapter setup, not installs. It reads the adapter registry and
   returns the one-time code, manifest, copy command, and `clara://adapter` link
   when the owner enables adapter setup in the panel. SSH keys and the Docker
   socket stay on the machine that runs the install.
10. The hub binary is unchanged by how the panel is opened. It still serves one
    loopback panel page and one local listener; it does not serve the web client
    or a second GUI. The `/v1/hub-panel` bridge is a hub-service route, not a new
    process or port.
11. The hub bridges the lab, it does not host it. The lab service runs next to
    the engine; the hub forwards `/v1/lab/*` to it with `CLARA_LAB_URL` and the
    shared `CLARA_LAB_TOKEN`. The hub holds no engine token and runs no lab
    process. `CLARA_LAB_URL=off` disables the bridge.

## Commands

```text
clara-server serve [--no-panel]
clara-server setup [--username <name>] [--password-stdin]
clara-server pair [--no-relay] [--no-qr] [--revoke-all] [--revoke <id>]
clara-server pair-adapter --kind <kind> [--transport local|relay|docker] [--json]
clara-server admin reset|setup-token
clara-server health
```

## Edge cases

- **Panel port busy**: bind an ephemeral port and publish it in the runtime
  file.
- **First run**: the hub serves only the setup screen until the owner account
  exists. `clara-server setup` can create it without a browser.
- **Setup is interrupted**: stopping during setup keeps the hub unconfigured;
  the next start shows the setup screen again.
- **Local port busy**: bind an ephemeral port and publish it. Existing local
  pairings may need a new pairing; relay pairings do not.
- **Relay URL without the hub token**: the hub starts local-only. The panel
  marks the token as missing, and saving it in the Relay card starts the relay
  without restarting the process. Startup never fails for an incomplete relay.
- **Existing hub**: the runtime lock refuses a second hub for the same data
  directory.
- **Stale runtime file**: a dead PID is ignored and the lock is cleared.
- **Process exits**: the service manager or container restarts it; the database
  is checkpointed on the way out.
- **Panel build missing**: the Bun build fails before it writes an executable.
- **No panel**: `--no-panel` leaves only the API/WebSocket listener. The owner
  account must already exist.
- **No client is paired yet**: the loopback panel still works. This is the
  surface that creates the owner and issues the first client code.
- **The panel is opened from Clara Desktop**: the request reaches the loopback
  listener through the E2EE bridge. The hub keeps one process.
- **The panel session expires in the bundled panel**: Clara Desktop asks for the
  owner credentials again. The loopback panel's cookie session is separate.
- **Orchestration**: the hub does not run the engine in-process. Use the
  engine container or `clara start engine`.
- **The lab service is unreachable**: `/v1/lab/*` returns `503 lab_unavailable`.
  Start the lab service next to the engine, or fix `CLARA_LAB_URL`; a token
  mismatch fails the lab's own authentication.
- **The lab bridge is off**: `CLARA_LAB_URL=off` makes the bridge return
  `503 lab_unavailable` without contacting a service. The hub keeps running.
- **A remote hub needs the lab on its private network**: set `CLARA_LAB_HOST` and
  `CLARA_LAB_ALLOW_REMOTE=1` on the lab service. Do not expose the lab publicly.

## Out of scope

- A desktop shell, tray icon, or native window for the hub.
- Signed and notarized desktop installers and an auto-updater.
- Running the engine inside the hub process.
- Serving the web client from the hub. The web PWA and web container remain
  separate.

## Technical appendix

<details>
<summary>Build wiring and code locations</summary>

- `apps/hub/server` owns the hub service and the Bun executable build.
- `pnpm hub:binary` builds the panel, embeds it, and compiles one executable
  with `apps/hub/server/scripts/build-bun.mjs`. The default output is
  `apps/hub/server/dist/bun/clara-server`; `--target` accepts a Bun target such
  as `bun-linux-x64` or `bun-darwin-arm64`.
- `pnpm hub:headless` reuses that build and writes a standalone archive under
  `dist/headless` with a Linux systemd unit, macOS LaunchAgent, or Windows
  sign-in task and an install helper. Build each platform on its own host or
  with `.github/workflows/hub-installers.yml`.
- `apps/hub/server/src/bun.ts` extracts the embedded panel and calls
  `./main.ts`. The executable uses the `bun` export condition of
  `@clara/sqlite`, so `bun:sqlite` replaces better-sqlite3.
- The embedded panel builds from `packages/panel` through the
  `apps/hub/panel` entry. The same package is mounted by Clara Desktop at
  `/hub`; that route talks to the hub service bridge and never reaches a
  desktop shell. No new process or port is involved.
- `apps/hub/server/scripts/build-bun.mjs` maps the host or `--target` Bun target
  and embeds relay files when `ENABLE_CLOUDFLARE_DEPLOYMENT` is on.
- Runtime file: `CLARA_RUNTIME_FILE`, or the platform path from
  `packages/runtime-state`. The hub writes it; the CLI, MCP, and desktop shell
  read it.
- Hub environment: `CLARA_CONFIG_DIR`, `CLARA_DATA_DIR`, `CLARA_CACHE_DIR`,
  loopback bind hosts, and `CLARA_CONTROL_STDIN=1`. The hub chooses the ports.
  `CLARA_ADAPTER_REGISTRY_URL` overrides the adapter registry; the panel can
  edit the same value in `server.json`. `CLARA_LAB_URL` (default
  `http://127.0.0.1:8791`, `off` disables the bridge) and `CLARA_LAB_TOKEN`
  point the `/v1/lab/*` bridge at the lab service next to the engine. The lab
  service itself reads `CLARA_LAB_HOST` and `CLARA_LAB_ALLOW_REMOTE=1`; the hub
  never holds the engine token.
- Docker: `infra/docker/server.Dockerfile` builds the same Bun executable; the
  Node fallback is `server-node.Dockerfile`. Compose keeps the fixed
  `8788`/`8790` mappings and uses `clara-server health` for the healthcheck.
- See [development.md](../development.md) for build commands and
  [panel.md](panel.md) for the panel surface.

</details>
