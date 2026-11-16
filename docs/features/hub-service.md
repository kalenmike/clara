# Hub service

## Summary

Clara ships the hub two ways: a single `clara-server` executable that runs the
hub service with its panel embedded, and the packaged `clara` command that runs
that same hub next to the engine, the Lab service, and the web client. Both use
the same database, transports, pairing, and adapter routing.

## User flow

1. Install a release. Unpack the archive and run `clara-server serve`, or install
   `clara` with `install.sh` or `install.ps1` and run `clara setup`.
2. On first run the hub serves only its loopback panel. Create the owner account
   in the browser, or run `clara-server setup --username <name> --password-stdin`.
3. Follow the Setup modal: choose Local only or configure the relay, pair a
   harness, then pair a client. Dismiss it and resume from **Settings → Setup**.
4. Open Clara on the paired device from the link or QR code the modal shows.
5. Pull a harness adapter with `clara adapter search` and
   `clara adapter install <kind>`; adapters are never bundled.
6. Watch the stack with `clara ps`, read a service with `clara logs <service>`,
   and restart one target with `clara restart <service>`.
7. Update with `clara update`; `clara update --check` only reports, and
   `clara update --rollback` returns to the previous version.
8. Stop with `clara stop`, or `clara-server` with `SIGINT` or `SIGTERM`.

## Core business rules

1. One process, one hub. `serve` starts the local WebSocket/API listener, the
   relay client, and the panel in one process and never spawns a child server.
   A runtime lock makes one hub own a data directory; a second launch prints the
   running endpoints and exits.
2. First run is panel-only. Until the owner account exists the hub starts no
   transport and no pairing; the loopback setup screen and its two auth routes
   are the only surfaces. `--no-panel` skips the panel and needs that account.
3. Ports are discovered, not hardcoded. The panel prefers its previous port and
   falls back to an ephemeral one. The local listener prefers
   `CLARA_LOCAL_PORT`, then an explicit `server.json` value, then the previous
   runtime port, then `8788`, then an ephemeral port. An auto-selected port is
   never written to `server.json`.
4. The runtime file is the local discovery contract. The hub writes the live
   ports, pid, paths, and version; the command, MCP, and desktop client read it,
   and remote relay clients never do. A stale file with a dead pid is ignored.
5. Direct access picks the interfaces the local listener binds: **loopback**,
   **docker** (loopback plus Docker bridge addresses), **lan** (all interfaces),
   or **custom**. It lives in `server.json`, `CLARA_LOCAL_ACCESS` overrides it,
   and changing it rebinds only that listener. The panel stays on its own port.
   See [panel/network.md](panel/network.md).
6. The hub shuts down on `SIGINT`, `SIGTERM`, `shutdown` on stdin, or stdin EOF
   when `CLARA_CONTROL_STDIN=1`. It checkpoints SQLite on the way out. The
   `clara` supervisor gives every child one bounded stop window, then kills what
   is left, and always exits before its deadline.
7. Panel assets are embedded at build time and extracted once per build into the
   cache directory. The shipped artifact is one file, and the panel page is a
   loopback HTTP surface with Host/Origin checks and no desktop IPC.
8. Releases are signed. `clara update` verifies an Ed25519 signature over
   `manifest.json` with a public key compiled into the binary, then verifies the
   archive checksum. A failed check never replaces the installed version, and a
   build without a public key refuses to update.
9. Autostart is per-user, never root: a systemd user unit, a launchd LaunchAgent,
   a Windows logon task, or XDG autostart. `clara setup` installs it on request,
   and a login service runs the same supervisor in the foreground.
10. Adapters are pulled, not bundled. The command reads the adapter registry,
    verifies the artifact SHA-256 before extraction, installs under the data
    directory, and runs the adapter's own installer with a code from the hub.
    The hub issues the code and command but never executes an install; adapter
    setup is off until the owner enables **Network → Adapter setup**.
11. `clara start` detaches one supervisor that starts engine → Lab → hub → web
    and restarts a crashed child a few times a minute. `status`/`ps` reads live
    state, `stop` stops the whole set, and `logs` follows one service.
12. The hub bridges the Lab; it does not host it. `/v1/lab/*` is forwarded to
    `CLARA_LAB_URL` with the shared `CLARA_LAB_TOKEN`; the hub holds no engine
    token and runs no Lab process. `CLARA_LAB_URL=off` disables the bridge.

## Edge cases

- **Panel port busy**: bind an ephemeral port and publish it in the runtime file.
- **Local port busy**: bind an ephemeral port. Direct adapters and local clients
  reconnect; relay clients are unaffected. The desktop client refreshes its
  local endpoint without re-pairing.
- **Docker access without Docker**: no bridge address exists, so the listener
  stays on loopback and the panel offers a direct address or the relay. Bridge
  addresses are read at startup, so restart after the daemon appears.
- **All interfaces selected**: the WebSocket and API are reachable on the
  network. The host firewall must allow only the intended sources.
- **Relay URL without a hub token**: the hub runs local-only, the panel marks the
  token missing, and saving it starts the relay without a restart.
- **Second launch on one data directory**: the runtime lock refuses it and prints
  the running endpoints.
- **Stale `services.json`**: a stop that could not finish keeps the recorded pids,
  the next `clara stop` retries them, and `clara start` clears them first.
- **A child ignores `SIGTERM`**: the supervisor kills the set after a short grace
  and the command reports any survivor instead of claiming a clean stop.
- **Unsupported login manager**: setup skips autostart with a visible note and
  `clara start` keeps working.
- **Signature or checksum failure**: the update aborts before touching the
  installed version.
- **Windows cannot replace a running executable**: the updater downloads and
  verifies first, swaps through a temporary file, then restarts the stack.
- **Lab unreachable or off**: `/v1/lab/*` returns `503 lab_unavailable`; the hub
  keeps running.

## Out of scope

- A desktop shell, tray icon, or native window for the hub.
- A system-wide (root) service install or a second hub for one data directory.
- Bundling a harness adapter, runner, or Node runtime.
- Running the engine inside the hub process, or serving the web client from it.
- Signed macOS notarization; the binaries stay unsigned until that pipeline
  exists.

## Technical appendix

<details>
<summary>Commands, paths, and references</summary>

```text
clara-server serve [--no-panel]
clara-server setup [--username <name>] [--password-stdin]
clara-server pair [--no-relay] [--no-qr] [--revoke <id>|--revoke-all]
clara-server pair-adapter --kind <kind> [--transport local|relay|docker] [--ws-url <url>] [--json]
clara-server admin reset|setup-token
clara-server health

clara setup | start | stop | restart | status | ps | logs [service] | doctor | version
clara start [default|hub|web|engine|lab] [--build]
clara update [--check|--rollback]
clara service install|uninstall|status|print
clara adapter search|install <kind>|list|upgrade|verify|remove
clara uninstall [--purge]
```

- Default ports: panel `8790`, hub local WebSocket `8788`, engine `8789`, Lab
  `8791`, web `8080`. Config `~/.config/clara`, data `~/.local/share/clara`,
  cache `~/.cache/clara`, each with its existing environment override.
- Runtime file: `$XDG_RUNTIME_DIR/clara/runtime.json` on Linux,
  `~/Library/Application Support/Clara/runtime.json` on macOS, and
  `%LOCALAPPDATA%\Clara\runtime.json` on Windows; `CLARA_RUNTIME_FILE` overrides.
- A release reports its release version; a checkout build reports
  `<package version>-dev+<7-character commit>`. `--json` output is stable and
  never colored, and human output uses tables and state glyphs only on a tty.
- Build: `pnpm hub:binary` embeds the panel and compiles one executable;
  `pnpm hub:headless` adds a service definition and install helper under
  `dist/headless`; `pnpm cli:build` builds the packaged command.
- See [installation](install.md), [adapters](harness-adapters.md),
  [architecture overview](../architecture/overview.md), and
  [panel access](panel/access.md).

</details>
