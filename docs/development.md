# Development workflow

## Summary

All new work starts in a task worktree. The primary checkout is the place to
create worktrees, run repository-wide commands, and land finished work; it is
not the place to edit or commit.

Task worktrees live under `../clara-worktrees` next to the repository. Set
`CLARA_WORKTREES_DIR` to use another directory. Each task gets one branch named
`task/<name>` and one directory named after the task.

## Task worktrees

```bash
pnpm task session start my-change   # create and install
pnpm task session list              # name, branch, state, path
pnpm task session close my-change   # check, merge, remove
```

`start` must run from the primary checkout. It refuses a dirty primary tree,
creates the worktree from `HEAD` (or `--base <ref>`), installs dependencies with
`pnpm install --frozen-lockfile --prefer-offline`, and prints the path. Pass
`--no-install` to skip the install. A task name is optional; without one the
command generates a timestamped name.

Move the OpenCode session into the printed directory, or `cd` there. Do all
edits, tests, and commits in the worktree. Do not reuse a worktree for a
different task.

`close` must also run from the primary checkout. It:

1. refuses a worktree or primary checkout with uncommitted changes;
2. installs dependencies in the worktree;
3. runs `pnpm check` and `pnpm build` in the worktree;
4. merges `task/<name>` into the primary checkout's current `HEAD` with a
   merge commit;
5. removes the worktree and deletes the branch.

If the merge conflicts, it aborts the merge and leaves the worktree and branch
in place. If a check or build fails, it leaves the worktree in place. A task
worktree with no commits is removed without merging.

The primary checkout's current branch is the merge target. Normally that is
`main`.

## Worker tests

`@clara/relay` runs its tests in `workerd` through the Cloudflare Vitest pool.
`workerd` is a glibc binary, so the suite needs a glibc host such as Debian or
Ubuntu and does not run on musl hosts.

## Optional build features

`ENABLE_CLOUDFLARE_DEPLOYMENT` compiles the hub panel's one-click Cloudflare
relay deployment into the panel and hub service. It is a build-time switch, not a
runtime setting; changing it requires rebuilding both artifacts.

```bash
ENABLE_CLOUDFLARE_DEPLOYMENT=true pnpm build
ENABLE_CLOUDFLARE_DEPLOYMENT=true pnpm dev:server
ENABLE_CLOUDFLARE_DEPLOYMENT=true pnpm dev:panel
```

Docker builds forward the same flag through the `server` compose build args:

```bash
ENABLE_CLOUDFLARE_DEPLOYMENT=true clara start hub --docker --build
```

Anything other than `1`, `true`, `yes`, or `on` builds without the feature. The
feature source is isolated under `apps/hub/server/src/features/cloudflare-deployment`
and `apps/hub/panel/src/features/cloudflare-deployment`; the core imports only
the feature loader. `pnpm check:boundaries` enforces that boundary.

### Desktop bundles in Docker

`pnpm desktop:build:docker` builds the Linux desktop bundles in Debian 12 with
Rust and the WebKitGTK toolchain, then extracts them to `dist/desktop`. It needs
Docker with Buildx; Cargo, Tauri's tool downloads, and the Rust target directory
stay in build cache mounts, so repeat builds are incremental.

```bash
pnpm desktop:build:docker
pnpm desktop:build:docker --bundles deb --platform linux/amd64
```

A Linux container cannot produce macOS or Windows installers; build those on
their own hosts. AppImage bundling sets `NO_STRIP` and extract-and-run so
linuxdeploy survives without FUSE; narrow the bundle list if it still fails. See
[features/desktop.md](features/desktop.md).

### Hub app

`apps/hub/desktop` is a second Tauri app: a tray shell around the Bun hub
sidecar. It needs the same Rust and WebView prerequisites, plus Bun 1.4+. The
sidecar build embeds the panel and compiles one executable.

```bash
pnpm hub:sidecar   # panel + embedded-asset sidecar only
pnpm hub:dev       # sidecar, then the tray app
pnpm hub:build     # sidecar, then the host installer
pnpm hub:headless  # standalone server archive and install helpers
```

`pnpm hub:build:docker` builds the Linux bundles in Debian 12 with Rust, Node,
and Bun, then extracts them to `dist/hub`. The image compiles the panel and the
Bun sidecar first, then lets Tauri bundle the tray shell around the sidecar
executable. It takes the same `--bundles`, `--platform`, `--output`, `--base`,
and `--no-cache` options as the desktop build, plus `--cloudflare` (or
`ENABLE_CLOUDFLARE_DEPLOYMENT`) to embed the relay. Like the desktop build, it
cannot produce macOS or Windows installers.

```bash
pnpm hub:build:docker
pnpm hub:build:docker --bundles deb --platform linux/amd64
```

`pnpm build` does not build either Tauri app. See
[features/hub-app.md](features/hub-app.md) for ports, the runtime file, and the
Docker switch.

`pnpm hub:headless` reuses the sidecar build and writes a standalone archive
under `dist/headless` with the executable, an install helper, and a Linux
systemd unit, macOS LaunchAgent, or Windows sign-in task. Build each platform on
its own host. `.github/workflows/hub-installers.yml` runs the tray and headless
builds on macOS arm64/x64, Linux x64, and Windows x64.

Each build verifies the result:

- enabled: the Cloudflare API routes, panel UI chunk, and `dist/relay/worker.mjs`
  are present;
- disabled: those routes, strings, and the relay artifact are absent.

### Panel UI and adapter installs

`packages/panel` (`@clara/panel`) owns the shared panel UI. The hub service serves
it on the loopback panel listener, and the web and desktop clients render the
same package at `/hub` over the paired E2EE session. Hosts differ only in the API
transport and capability set: the served panel keeps its HttpOnly session
cookie, while a tunneled panel uses a session bearer token and disables controls
that would cut its own connection.

`apps/desktop/host` is the loopback adapter-host sidecar. It reuses
`packages/adapters/install` for planning, target discovery, and jobs, and it
remains the surface that runs local, SSH, and Docker adapter installs.

## Developer commands

```bash
# Lifecycle
clara start [default|hub|web|engine|adapter|runner|lab|docs] [--docker|--local] [--build]
clara stop [default|hub|web|engine|adapter|runner|lab|docs] [--docker|--local]
clara restart [default|hub|web|engine|adapter|runner|lab|docs] [--docker|--local] [--build]
clara status [default|hub|web|engine|adapter|runner|lab|docs] [--json]
clara logs [default|hub|web|engine|adapter|runner|lab|docs] [--local|--docker]
clara start hub --open
clara status hub --open
clara backup [default|hub|engine] [--output <path>]
clara restore [default|hub|engine] <archive> [--force]

# Adapters
clara start adapter [--harness <name>]
clara start adapter --harness opencode --pair [<code>]
clara stop adapter [--harness <name>] [--mcp] [--purge]
clara status adapter [--harness <name>] [--json] [--verify]
clara logs adapter [--harness <name>]
clara pair adapter --harness <name>

# Runner
clara start runner [--workspace <path>]
clara stop runner [--purge]
clara status runner [--json]

# Setup
clara pair [hub] [--no-relay] [--no-qr] [--no-panel] [--revoke-all] [--revoke <id>]

# Sites
clara start lab [--workspace <path>]
clara status lab --check
clara start docs [--build]
clara status docs --check
clara status docs --typecheck

# Maintenance
clara rebuild <status|build|adapters|restart|health|inspect|recover> [--docker|--local|--all]
pnpm check:boundaries
```

Run `clara --help` for the command list and `clara <command> --help`
for one command.

## Hub API

The hub serves its API on the local listener (default `http://127.0.0.1:8788`).
Swagger UI is at `/docs` and the OpenAPI document is at `/openapi.json`. The
loopback API requires the bearer token in the hub config directory
(`api.token`); the WebSocket transport authenticates with the paired device.

Response DTOs and OpenAPI components live in `packages/contracts/api-contract` as zod
schemas. The hub registers them directly with `hono-openapi`; there is no
generation step. `@opencode/client` stays inside `apps/hub/server` and `tools/lab`,
and `pnpm check:boundaries` enforces that split.

Install the read-only API MCP for live frontend testing:

```bash
clara start adapter --harness opencode --mcp-api
```

The bridge reads `CLARA_API_URL` (default `http://127.0.0.1:8788`) and
`CLARA_API_TOKEN_FILE` (default `<hub config dir>/api.token`). See
[architecture/api.md](architecture/api.md).

`pnpm clara:link` installs a thin `clara` shim under `~/.local/bin`. It runs the
checkout's Node entry, so it does not need pnpm at invocation time; `--build`,
Docker Compose, local service scripts, and the MCP bridge still use the
checkout. The `pnpm clara …` script in the checkout remains an alias for the same
entry point.

`clara start` starts Docker by default: it creates the `clara` network,
bootstraps `infra/docker/.env` and the engine token on first run, then
starts the selected targets in engine, hub, web order. Pass `--local` to
run the same targets as detached local processes. `--build` rebuilds before
starting. Select one target with `start hub`, `start web`, or
`start engine`; there are no `--no-*` flags.

`hub` is the public target name for the hub service. Docker resources keep their
`clara-server` names so existing volumes and containers keep working.

`clara start hub --open` starts the hub and opens the panel;
`clara status hub --open` opens a panel that is already running. Headless
hub maintenance uses `clara-server setup` and `clara-server admin` directly.

Local processes keep a PID and log under `~/.local/share/clara`, so
`clara stop --local`, `restart --local`, and `logs --local` work the same
way as the Docker stack. Stop also resolves a service that was restarted
outside the PID files: the hub through its runtime file, and the web client
through the pid in its `/healthz` response. Discovered processes are checked
against the expected command line before they are signalled, a port owner must
match, and a process that ignores SIGTERM is forced with SIGKILL. A hub managed
by the documented `clara` user systemd unit is reported but never signalled;
stop it with `systemctl --user stop clara`. Local web serves the built
`apps/web/dist` on `CLARA_WEB_PORT`.

`clara status` renders one table for the selected targets, using the same
record shape for `hub`, `web`, and `engine`. The hub row uses its local
listener URL; Details names the panel URL. Add `--json` for a machine-readable
record or a `{ "ok": true, "services": [...] }` envelope.

`clara status adapter` reports every supported harness, including ones that
are not installed. `--harness opencode` narrows the table. `--verify` runs the
adapter's native-store verification. `clara start adapter` starts every
paired adapter; `--harness <name> --pair` installs and pairs one. `--pair`
without a code asks the hub for a fresh code and fails with a clear hint when no
hub is reachable. The MCP bridge is registered with `--mcp` and removed with
`stop adapter --mcp`; it is a stdio process, not a service.

`clara start runner` installs and starts the shared script runner;
`--foreground` runs it in the foreground. `clara start lab` and
`clara start docs` run the host-only development sites. Their one-shot
checks are `status lab --check`, `status docs --check`, and
`status docs --typecheck`.

`clara rebuild` snapshots the running services, rebuilds the primary
checkout, installs the adapters, restarts only the captured services, and
verifies their health. It manages Docker services by default; pass `--local`
for local services or `--all` for a mixed setup. The standard
`std:maintenance/rebuild` pipeline drives the same commands one step at a time;
see [features/maintenance.md](features/maintenance.md).

Use these commands instead of calling the workspace scripts directly so that
agents and developers share one command surface.

## Local and Docker state

Docker is optional. A local install keeps using the host directories; the
Docker stack uses volumes and a Docker-only control directory. Neither mode
reads the other's service state.

| State           | Local install                       | Docker stack                               |
| --------------- | ----------------------------------- | ------------------------------------------ |
| Server config   | `~/.config/clara`                   | volume `clara-server-config`               |
| Server database | `~/.local/share/clara/clara.db`     | volume `clara-server-data`                 |
| Engine database | `~/.local/share/clara/engine.db`    | volume `clara-orchestrator-data`           |
| Engine token    | `~/.local/share/clara/engine.token` | `~/.local/share/clara/docker/engine.token` |
| Compose input   | none                                | `infra/docker/.env`                        |
| Workspace       | host path                           | bind mount at `/workspace/clara`           |

`CLARA_DOCKER_STATE_DIR` moves the Docker control directory. The workspace and
the rebuild snapshot under `~/.local/share/clara/rebuild` are the only shared
host paths. Back up Docker volumes with `clara backup`; back up a local
install by archiving its two host directories.

`clara pair` probes the panel's `/health` mode and then the Docker/local
state to pick a target, and prints which one it chose. `--docker` forces the
`clara-server` container and `--local` forces a local install. When both a local
install and Docker state exist and neither is running, the command refuses to
guess and exits; pass one of the flags.

Hub setup, setup tokens, and admin resets use the hub binary directly:
`node apps/hub/server/dist/index.js setup --password-stdin` for a local install
or `docker exec clara-server /app/clara-server setup --password-stdin` for a
container. The installed `clara-server` binary supports the same commands.

### One-time migration to Docker volumes

Existing Docker installs that still bind `~/.config/clara` and
`~/.local/share/clara` need one manual copy. Stop the stack first.

```bash
clara stop
tar -czf ~/clara-local-state-backup.tar.gz \
  ~/.config/clara \
  ~/.local/share/clara/clara.db* \
  ~/.local/share/clara/engine \
  infra/docker/.env
docker volume create clara-server-config clara-server-data clara-orchestrator-data
docker run --rm \
  -v clara-server-config:/to/config \
  -v clara-server-data:/to/data \
  -v clara-orchestrator-data:/to/engine \
  -v "$HOME/.config/clara:/from/config:ro" \
  -v "$HOME/.local/share/clara:/from/data:ro" \
  node:22-bookworm-slim \
  sh -c '
    if [ -d /from/config ]; then cp -a /from/config/. /to/config/; fi &&
    find /from/data -maxdepth 1 -name "clara.db*" -exec cp -a {} /to/data/ \; &&
    if [ -d /from/data/engine ]; then cp -a /from/data/engine/. /to/engine/; fi &&
    chown -R 1000:1000 /to
  '
```

Remove `CLARA_DATA_DIR` from `infra/docker/.env`, then start and verify the panel,
harness connection, and pairing:

```bash
clara start
clara status
```

Keep the archive until the stack is healthy. Move the old directories aside
instead of deleting them; keep `~/.local/share/clara/rebuild` and the local
`engine.token` if a local install is still used:

```bash
mkdir -p ~/.local/share/clara-pre-volumes
mv ~/.config/clara ~/.config/clara-pre-volumes
mv ~/.local/share/clara/clara.db* ~/.local/share/clara-pre-volumes/
mv ~/.local/share/clara/engine ~/.local/share/clara-pre-volumes/
```

The Docker stack writes its control token to
`~/.local/share/clara/docker/engine.token`, so a local install can keep
using `~/.local/share/clara/engine.token` unchanged.

## Pipeline development

Pipeline authors work on the package files directly, then use Clara Lab to see
what the compiler resolves:

```bash
clara start lab                              # preview + probe in a browser
pnpm dev:lab                           # Vite on :5175, lab server on :8791
clara status lab --check --target std:software/feature
clara status lab --check --json                 # CI-friendly diagnostics
```

`check` exits non-zero on compile errors. It ignores warnings, so it can run in
a pre-commit hook or CI without blocking on author feedback. The lab compiles
the files on the host; when the engine runs in a container, enter the host
path under **Files on this machine** and the container mount under **Workspace
inside the engine** in Setup, then run **Check setup**. See
[features/lab.md](features/lab.md).
