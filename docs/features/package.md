# Packaged command

## Summary

Clara ships as one `clara` executable for Linux, macOS, and Windows. It contains
the hub service, the authenticated panel, the engine, the web client, and the
command that runs them. People install it from a signed release, run
`clara setup`, and control the local stack without Docker, Node, or a checkout.

## User flow

1. Download `clara` with the published `install.sh` or `install.ps1`, or unpack a
   release archive and put `clara` on `PATH`.
2. Run `clara setup`. It creates the config and data directories, asks for the
   hub owner account, starts the stack, and optionally installs a login service.
3. Open the panel URL it prints, or pair a client with the code from
   `clara pair hub`.
4. Run `clara ps` at any time to see the engine, hub, and web client with their
   state, endpoint, pid, and uptime.
5. Run `clara adapter search`, then `clara adapter install <kind>` to pull a
   harness adapter from the release registry. Adapters are never bundled.
6. Run `clara update` to install a newer release. `clara update --rollback`
   returns to the previous version.
7. Run `clara stop` to stop the stack, or `clara service uninstall` to remove
   autostart. `clara uninstall --purge` removes local data too.

## Core business rules

1. One binary, one version. The command, hub, engine, panel, and web client are
   compiled together, so they cannot drift apart. Assets are extracted once per
   build into the cache directory and each service reads its own subtree.
2. One supervisor. `clara start` detaches a single `__supervise` process that
   starts engine → hub → web, restarts a crashed child a few times, and stops
   everything in reverse order. A login service runs the same supervisor in the
   foreground.
3. Ports and paths match the existing services. Hub panel `8790`, hub local
   WebSocket `8788`, engine `8789`, web `8080`; `~/.config/clara`,
   `~/.local/share/clara`, and `~/.cache/clara`, with the existing environment
   overrides. The hub keeps its runtime file and ephemeral-port behavior.
4. Adapters are pulled, never shipped. The command reads the adapter registry,
   verifies the artifact SHA-256 before extraction, installs under the data
   directory, and runs the adapter's own installer with a pairing code from the
   hub.
5. Releases are signed. The command verifies an Ed25519 signature over
   `manifest.json` with a public key compiled into the binary, then verifies the
   archive checksum. A failed signature or checksum never replaces the installed
   version.
6. Autostart is per-user, never root. The supported mechanisms are systemd user
   units, launchd LaunchAgents, a Windows logon task, and XDG autostart for
   Linux desktops without systemd. Hosts with none of these print a definition
   to install and keep working with `clara start`.
7. JSON output is stable and never colored. Human output uses a spinner, state
   glyphs, and aligned tables only when stdout is a terminal.

## Edge cases

- **A port is busy**: the hub records the port it actually bound; `clara ps`
  reads the runtime file, so the endpoint stays correct.
- **The stack is already running**: `clara start` reports the current stack
  instead of starting a second supervisor.
- **A service crashes**: the supervisor restarts it up to three times in a
  minute, then marks it failed and leaves the other services running.
- **A stale `services.json`**: a dead supervisor pid is ignored and the state is
  replaced on the next start.
- **The web or panel build is missing at build time**: the binary build fails
  before it writes an executable.
- **No supported login manager**: setup skips autostart with a visible note.
- **No release public key in the build**: updates refuse to run rather than
  trusting an unverified manifest.
- **Windows cannot replace a running executable**: the update downloads and
  verifies first, then swaps the binary through a temporary file and restarts
  the stack.
- **The adapter registry is unreachable**: `adapter search` reports the failing
  kind and continues with the rest.
- **Uninstall without `--purge`**: the command and login service are removed,
  but the hub database, config, and adapters stay.

## Out of scope

- A desktop shell or tray icon for the hub.
- Bundling any harness adapter, runner, or Node runtime.
- A system-wide (root) service install.
- Signed macOS notarization; the binaries are unsigned until that pipeline
  exists.
- Installing adapters on another machine; the hub still prints a copy command
  for remote hosts.

## Technical appendix

<details>
<summary>Commands, paths, and release artifacts</summary>

- Commands: `start`, `stop`, `restart`, `status`/`ps`, `logs`, `pair hub`,
  `setup`, `update`, `service`, `adapter`, `runner`, `doctor`, `uninstall`,
  `version`.
- Hidden dispatch: `__serve hub|engine|web|runner`, `__supervise`, `__hub`.
- State: `services.json` and `supervisor.pid` under the data directory; logs in
  `<data>/logs/<service>.log`.
- Release assets: `manifest.json`, `manifest.json.sig`, `install.sh`,
  `install.ps1`, and `clara-<platform>.tar.gz` or `.zip` for `linux-x64`,
  `linux-arm64`, `darwin-x64`, `darwin-arm64`, and `win32-x64`.
- Version store: `<data>/versions/<version>/clara` with `~/.local/bin/clara`
  pointing at the active version.
- Build: `pnpm cli:build`; smoke: `pnpm cli:smoke`; publish:
  `.github/workflows/package-releases.yml` with `CLARA_RELEASE_SIGNING_KEY`.
- Local builds: `pnpm cli:build` writes
  `apps/cli/dist/package/<bun-target>/clara`. `pnpm cli:install` installs that
  build without rebuilding it: it stages the binary under
  `<data>/versions/<version>/clara`, links it from the user bin directory, and
  writes `install.json` with channel `local`, so `clara doctor`, `clara update`,
  and `clara uninstall` work as for a release. `--from`, `--bin-dir`, and
  `--dry-run` change the source and target; `pnpm cli:uninstall [--purge]`
  removes the install through `clara uninstall`.

</details>
