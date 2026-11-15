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

## Incremental builds

`pnpm build` runs `turbo run build`. Each package's build task is cached against
its own tracked sources, the sources of every workspace package it depends on,
the root lockfile and config, the declared build-time environment, and the task
definition. A second run only executes tasks whose inputs changed.

Before a task runs or restores from cache, its `clean` script removes the
package's outputs. Turborepo restores cached files over the working tree without
deleting files that are no longer in the cache entry, so cleaning first keeps a
cache hit equivalent to a fresh build (no stale web chunks, bundles, or
feature-gated artifacts).

```bash
pnpm build                              # stale packages only
pnpm build:force                        # rebuild and rewrite every cache entry
pnpm build:changed                      # affected by this branch (main...HEAD)
pnpm exec turbo run build --dry=json    # task graph, hashes, inputs, outputs
pnpm exec turbo run build --filter=@clara/web
pnpm exec turbo run build --summarize   # run metadata under .turbo/runs
```

`build:changed` compares `main` with `HEAD`, so it builds nothing on `main`
itself and needs the branch history (a shallow clone falls back to every
package). It includes dependents of a changed package.

Edges the package manifests do not express are configured in `turbo.json`:
`@clara/hub-server` builds after the hub panel and hashes `infra/relay/src`,
`@clara/docs` hashes the root `docs/` tree, and `@clara/cli` and
`@clara/desktop-host` use the `transit` task to hash the source-exported
packages they bundle.

The web and panel builds embed the checkout commit and dirty flag. `CLARA_COMMIT`
and `CLARA_DIRTY` are part of their cache keys when set; without them, a
docs-only commit can reuse a cached build stamped with the previous commit. Run
`pnpm build:force` when the embedded identity must match the current commit.

The local cache lives in `.turbo/cache`, is capped at 10GB by `cacheMaxSize`, and
is shared with the primary checkout when running in a task worktree. Turn off
Turbo telemetry once per machine with `pnpm exec turbo telemetry disable`.

`pnpm cli:build` builds the panel and web assets through the cache and compiles
the binary with `--skip-assets`, so an unchanged binary is not rebuilt. Release
workflows still call `build:binary` directly and always build fresh assets.
`pnpm desktop:build` caches the web desktop bundle, the adapter-host sidecar, and
the installers; `pnpm desktop:build:app` always runs Tauri but reuses the cached
web and sidecar stages.

Cached tasks skip post-build validators such as `check-bundle.mjs`. A failing
validator fails the task and is never cached.

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

### Desktop release builds

`pnpm desktop:build:release` builds this platform's installers the way the
release workflow does. It stamps the release version into the Tauri config and
the web bundle, verifies the bundled adapter host, and writes
`dist/desktop-release` with `SHA256SUMS`. Tauri cannot cross-compile the
bundles, so `.github/workflows/desktop-releases.yml` runs the script on macOS
(arm64 and x64), Linux x64, and Windows x64 and publishes a `desktop-v*` tag's
installers. Its `dry_run` dispatch input builds every platform without touching
a release. Installers are unsigned.

### Hub CLI

The hub is a CLI service. `apps/hub/server` owns the hub code and the Bun
executable build. The build embeds the panel and compiles one executable; it
needs Bun 1.4+ but no Rust or WebView packages.

```bash
pnpm hub:binary    # panel + embedded-asset Bun executable
pnpm hub:headless  # standalone server archive and install helpers
```

`pnpm hub:binary` writes `apps/hub/server/dist/bun/clara-server` by default.
Pass `--target bun-linux-x64`, `bun-darwin-arm64`, or another Bun target for a
cross-build. `pnpm build` builds the Node server and panel, not the Bun
executable. See [features/hub-cli.md](features/hub-cli.md) for ports, the runtime
file, and the Docker image.

`pnpm hub:headless` reuses the Bun build and writes a standalone archive under
`dist/headless` with the executable, an install helper, and a Linux systemd
unit, macOS LaunchAgent, or Windows sign-in task. Build each platform on its own
host. `.github/workflows/hub-installers.yml` runs the headless build on macOS
arm64/x64, Linux x64, and Windows x64.

Each build verifies the result:

- enabled: the Cloudflare API routes, panel UI chunk, and `dist/relay/worker.mjs`
  are present;
- disabled: those routes, strings, and the relay artifact are absent.

### Packaged command

`apps/cli` builds the single `clara` executable that carries the hub, panel,
engine, and web client. It needs Bun 1.4+ and no Rust.

```bash
pnpm cli:build       # dist/package/<bun-target>/clara
pnpm cli:install     # stage the host build and link `clara` into ~/.local/bin
pnpm cli:uninstall   # remove the installed command
```

`pnpm cli:build` writes `apps/cli/dist/package/<bun-target>/clara` for the host
target. A checkout build reports `<package version>-dev+<7-character commit>`
unless `CLARA_VERSION` is set, so `clara status` and the version store identify
the exact build. `pnpm cli:install` never builds: it installs that build under
`<data>/versions/<version>/clara`, points the user bin directory at it, and
writes `install.json` with channel `local`, so `clara doctor`, `clara update`,
and `clara uninstall` treat it as a normal install. Use `--from <file|dir>`,
`--dry-run`, and `--bin-dir <dir>` to change the source and target. See
[features/package.md](features/package.md).

### Panel UI and adapter installs

`packages/panel` (`@clara/panel`) owns the shared panel UI. The hub service serves
it on the loopback panel listener, and the web and desktop clients render the
same package at `/hub` over the paired E2EE session. Hosts differ only in the API
transport and capability set: the served panel keeps its HttpOnly session
cookie, while a tunneled panel uses a session bearer token and disables controls
that would cut its own connection.

`packages/ui` (`@clara/ui`) owns the component library shared by every surface:
the shadcn primitives, `cn`, and the Clara patterns for status badges, notices,
empty states, key/value rows, copy actions, and section cards. Import from the
explicit component, pattern, or lib subpath; do not copy a primitive into a
surface package. See [features/ui.md](features/ui.md).

`packages/theme` (`@clara/theme`) owns the palettes and type tokens shared by the
web client, the hub panel, and the lab. Tailwind hosts import `theme.css`; the
standalone lab imports the Tailwind theme and utilities layers plus `theme.css`
without preflight.

`apps/desktop/host` is the loopback adapter-host sidecar. It reuses
`packages/adapters/install` for planning, target discovery, and jobs, and it
remains the surface that runs local, SSH, and Docker adapter installs.

## Developer commands

`clara` below is the packaged command (`pnpm cli` from source or
`pnpm cli:install` for the built binary). `clara-dev` is the checkout lifecycle
command (`pnpm clara:link` installs the shim).

```bash
# Lifecycle (clara-dev)
clara-dev start [default|hub|web|engine|runner|lab|docs] [--docker|--local] [--build]
clara-dev stop [default|hub|web|engine|runner|lab|docs] [--docker|--local]
clara-dev restart [default|hub|web|engine|runner|lab|docs] [--docker|--local] [--build]
clara-dev status [default|hub|web|engine|runner|lab|docs] [--json]
clara-dev logs [default|hub|web|engine|runner|lab|docs] [--local|--docker]
clara-dev start hub --open
clara-dev status hub --open
clara-dev backup [default|hub|engine] [--output <path>]
clara-dev restore [default|hub|engine] <archive> [--force]

# Adapters (packaged command)
clara adapter search [--json]
clara adapter list [--json]
clara adapter install <kind>[@version] [--pair <code>] [--from <path>] [--reuse-pairing]
clara adapter upgrade [kind] [--no-start]
clara adapter verify <kind> [--directory <path>] [--write] [--json]
clara adapter start|stop|status|logs <kind>
clara adapter remove <kind> [--purge]
clara pair adapter --harness <kind> [--install]

# Adapter development from this checkout
pnpm adapters:build --kind opencode --serve   # loopback registry on 127.0.0.1:8799
export CLARA_ADAPTER_REGISTRY_URL=http://127.0.0.1:8799
pnpm cli adapter install opencode             # or: --from apps/adapters/opencode
pnpm --filter @clara/adapter-opencode build   # rebuild before --from or --serve
clara-dev mcp install [--api]                 # checkout-only MCP bridge

# Runner (clara-dev)
clara-dev start runner [--workspace <path>]
clara-dev stop runner [--purge]
clara-dev status runner [--json]

# Setup (clara-dev)
clara-dev pair [hub] [--no-relay] [--no-qr] [--no-panel] [--revoke-all] [--revoke <id>]

# Sites (clara-dev)
clara-dev start lab [--workspace <path>]
clara-dev status lab --check
clara-dev start docs [--build]
clara-dev status docs --check
clara-dev status docs --typecheck

# Maintenance (clara-dev)
clara-dev rebuild <status|build|adapters|restart|health|inspect|recover> [--docker|--local|--all]
pnpm check:boundaries
```

Run `clara --help` or `clara-dev --help` for the command list and
`<command> --help` for one command.

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
clara-dev mcp install --api
```

The bridge reads `CLARA_API_URL` (default `http://127.0.0.1:8788`) and
`CLARA_API_TOKEN_FILE` (default `<hub config dir>/api.token`). See
[architecture/api.md](architecture/api.md).

`pnpm clara:link` installs a thin `clara-dev` shim under `~/.local/bin`. It
runs the checkout's Node entry, so it does not need pnpm at invocation time;
`--build`, Docker Compose, local service scripts, and the MCP bridge still use
the checkout. The `pnpm clara …` script in the checkout remains an alias for the
same entry point. Adapters belong to the packaged command; `pnpm cli` runs it
from source and `pnpm cli:install` installs that build.

`clara-dev start` starts Docker by default: it creates the `clara` network,
bootstraps `infra/docker/.env` and the engine token on first run, then
starts the selected targets in engine, hub, web order. Pass `--local` to
run the same targets as detached local processes. `--build` rebuilds before
starting. Select one target with `start hub`, `start web`, or
`start engine`; there are no `--no-*` flags.

`hub` is the public target name for the hub service. Docker resources keep their
`clara-server` names so existing volumes and containers keep working.

`clara-dev start hub --open` starts the hub and opens the panel;
`clara-dev status hub --open` opens a panel that is already running. Headless
hub maintenance uses `clara-server setup` and `clara-server admin` directly.

Local processes keep a PID and log under `~/.local/share/clara`, so
`clara-dev stop --local`, `restart --local`, and `logs --local` work the same
way as the Docker stack. Stop also resolves a service that was restarted
outside the PID files: the hub through its runtime file, and the web client
through the pid in its `/healthz` response. Discovered processes are checked
against the expected command line before they are signalled, a port owner must
match, and a process that ignores SIGTERM is forced with SIGKILL. A hub managed
by the documented `clara` user systemd unit is reported but never signalled;
stop it with `systemctl --user stop clara`. Local web serves the built
`apps/web/dist` on `CLARA_WEB_PORT`.

`clara-dev status` renders one table for the selected targets, using the same
record shape for `hub`, `web`, and `engine`. The hub row uses its local
listener URL; Details names the panel URL. Add `--json` for a machine-readable
record or a `{ "ok": true, "services": [...] }` envelope.

`clara adapter list` shows every installed adapter and its runtime state.
`clara adapter status <kind>` prints the hub link and harness health;
`clara adapter verify <kind>` runs the native-store checks, with `--directory`
and `--write` for a scratch session. `clara adapter install <kind>` issues a
fresh code from the hub when `--pair` is omitted. Pass `--from <package|dist>`
to install a build from a checkout instead of a registry release; an existing
pairing is reused unless `--pair` is also given. `clara adapter upgrade` reruns
the whole install with the saved pairing and replays the original install flags,
so a rebuild refreshes the binding, service, and runner without a new code.
`--mcp` registers the OpenCode MCP bridge during install; the bridge is a stdio
process, not a service.

For adapter development, either serve a local registry:

```bash
pnpm adapters:build --kind opencode --serve
export CLARA_ADAPTER_REGISTRY_URL=http://127.0.0.1:8799
pnpm cli adapter install opencode
```

or install the checkout's Node build directly:

```bash
pnpm --filter @clara/adapter-opencode build
pnpm cli adapter install opencode --from apps/adapters/opencode
pnpm cli adapter upgrade opencode   # reruns install without a new pairing
```

`clara-dev start runner` installs and starts the shared script runner;
`--foreground` runs it in the foreground. `clara-dev start lab` and
`clara-dev start docs` run the host-only development sites. Their one-shot
checks are `status lab --check`, `status docs --check`, and
`status docs --typecheck`.

`clara-dev rebuild` snapshots the running services, rebuilds the primary
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
