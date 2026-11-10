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
`workerd` is a glibc binary and does not run on musl hosts such as Alpine. The
relay test command probes the pinned binary before starting Vitest:

- a working `workerd` runs the suite as usual;
- a glibc loader mismatch prints a warning and skips the suite, so `pnpm check`
  and `pnpm task session close` still finish on musl hosts;
- any other failure, including a missing binary, stops the run.

Set `CLARA_REQUIRE_WORKERD=1` on glibc CI and release runners to turn the skip
into a failure. To use a different binary, set `MINIFLARE_WORKERD_PATH`; a
failure there is always fatal. On Alpine, run `pnpm --filter @clara/relay test`
inside a Debian/Ubuntu container for full Worker coverage.

## Native modules

`better-sqlite3` and Rollup select their prebuilt binaries from the libc Node
reports. Alpine images that install `gcompat` report a glibc version even though
Node runs on musl, so the patches under `patches/` inspect the loaded
interpreter instead. Keep those patches until the dependencies detect gcompat
correctly.

## Developer commands

```bash
# Stack
pnpm clara start [--local|--docker] [--no-server] [--no-web] [--no-orchestrator] [--build]
pnpm clara stop [--local|--docker] [--no-server] [--no-web] [--no-orchestrator]
pnpm clara restart [--local|--docker] [--no-server] [--no-web] [--no-orchestrator] [--build]
pnpm clara status [--no-server] [--no-web] [--no-orchestrator] [--json]
pnpm clara logs <server|web|orchestrator> [--local|--docker]
pnpm clara backup [--output <path>]
pnpm clara restore <archive> [--force]

# Services
pnpm clara server <start|stop|restart|status [--json]|panel|setup-token|pair|admin|logs> [--local|--docker] [--host] [--build]
pnpm clara web <start|stop|restart|status [--json]|logs> [--local|--docker] [--build]
pnpm clara orchestrator <serve|start|stop|restart|status [--json]|logs|token> [--local|--docker] [--build]
pnpm clara adapter install --opencode [--mcp]
pnpm clara mcp install|config|status
pnpm clara runner

# Setup
pnpm clara pair [--no-relay] [--no-qr] [--no-panel] [--revoke-all] [--revoke <id>] [--docker|--host|--local]

# Tools
pnpm clara lab [serve|check]
pnpm clara rebuild <status|build|adapters|restart|health|inspect|recover> [--docker|--local|--all]
```

Run `pnpm clara --help` for the command list and `pnpm clara <command> --help`
for one command.

`pnpm clara pair` runs the server source directly for a local target and does
not need a build. It probes the running deployment first; `--local`/`--host`
force the host install and `--docker` the container. Add `--no-relay` for a
local-only pairing code even when the agent has a relay configured.
`pnpm clara server panel` opens a panel that is already being served; start the
agent first with `pnpm clara server start --local` (or `--docker`).
`pnpm clara start` starts Docker by default: it creates the `clara` network,
bootstraps `docker/.env` and the orchestrator token on first run, then starts
the selected services in orchestrator, server, web order. Pass `--local` to run
the same selection as detached local processes instead; `--docker` is the
explicit default. Disable any part with `--no-server`, `--no-web`, or
`--no-orchestrator`; `restart` stops and restarts the selection. `--build`
rebuilds the checkout before starting in either mode.
Local processes keep a PID and log under `~/.local/share/clara`, so
`pnpm clara stop --local`, `restart --local`, and `logs ... --local` work the
same way as the Docker stack. `pnpm clara server start --local` replaces the
old `pnpm clara serve` foreground command; local web serves the built
`apps/web/dist` on `CLARA_WEB_PORT`. The scoped
`pnpm clara server start` and `pnpm clara orchestrator start` commands remain
available when only one service is wanted.
`pnpm clara status` renders one table for the selected services, using the same
record shape for `server`, `web`, and `orchestrator`. The server row uses its
local listener URL; Details names the panel URL. Add `--json` for a
machine-readable record or `{ "ok": true, "services": [...] }` envelope, and
select a subset with the same `--no-*` flags as `start`.
`pnpm clara web start --build` builds and serves the static SPA on
`127.0.0.1:8080`; `pnpm dev:web` remains the Vite development server. The agent
panel is the one-time harness setup surface; the server does not read OpenCode's
`service.json`. Local tooling such as Clara Lab reads the development password
from `${XDG_STATE_HOME:-~/.local/state}/opencode/service.json` or
`CLARA_OPENCODE_PASSWORD`.
`pnpm clara rebuild` snapshots the running services, rebuilds the primary
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

| State                 | Local install                             | Docker stack                                     |
| --------------------- | ----------------------------------------- | ------------------------------------------------ |
| Server config         | `~/.config/clara`                         | volume `clara-server-config`                     |
| Server database       | `~/.local/share/clara/clara.db`           | volume `clara-server-data`                       |
| Orchestrator database | `~/.local/share/clara/orchestration.db`   | volume `clara-orchestrator-data`                 |
| Orchestrator token    | `~/.local/share/clara/orchestrator.token` | `~/.local/share/clara/docker/orchestrator.token` |
| Compose input         | none                                      | `docker/.env`                                    |
| Workspace             | host path                                 | bind mount at `/workspace/clara`                 |

`CLARA_DOCKER_STATE_DIR` moves the Docker control directory. The workspace and
the rebuild snapshot under `~/.local/share/clara/rebuild` are the only shared
host paths. Back up Docker volumes with `pnpm clara backup`; back up a local
install by archiving its two host directories.

Host-side commands that read or write panel state (`pnpm clara server
setup-token`, `server admin`, and `pair`) probe the panel's `/health` mode and
then the Docker/local state to pick a target, and print which one they chose.
`--docker` forces the `clara-server` container and `--host` forces a local
install. When both a local install and Docker state exist and neither is
running, the command refuses to guess and exits; pass one of the flags.

### One-time migration to Docker volumes

Existing Docker installs that still bind `~/.config/clara` and
`~/.local/share/clara` need one manual copy. Stop the stack first.

```bash
pnpm clara stop
tar -czf ~/clara-local-state-backup.tar.gz \
  ~/.config/clara \
  ~/.local/share/clara/clara.db* \
  ~/.local/share/clara/orchestrator \
  docker/.env
docker volume create clara-server-config clara-server-data clara-orchestrator-data
docker run --rm \
  -v clara-server-config:/to/config \
  -v clara-server-data:/to/data \
  -v clara-orchestrator-data:/to/orchestrator \
  -v "$HOME/.config/clara:/from/config:ro" \
  -v "$HOME/.local/share/clara:/from/data:ro" \
  node:22-bookworm-slim \
  sh -c '
    if [ -d /from/config ]; then cp -a /from/config/. /to/config/; fi &&
    find /from/data -maxdepth 1 -name "clara.db*" -exec cp -a {} /to/data/ \; &&
    if [ -d /from/data/orchestrator ]; then cp -a /from/data/orchestrator/. /to/orchestrator/; fi &&
    chown -R 1000:1000 /to
  '
```

Remove `CLARA_DATA_DIR` from `docker/.env`, then start and verify the panel,
harness connection, and pairing:

```bash
pnpm clara start
pnpm clara status
```

Keep the archive until the stack is healthy. Move the old directories aside
instead of deleting them; keep `~/.local/share/clara/rebuild` and the local
`orchestrator.token` if a local install is still used:

```bash
mkdir -p ~/.local/share/clara-pre-volumes
mv ~/.config/clara ~/.config/clara-pre-volumes
mv ~/.local/share/clara/clara.db* ~/.local/share/clara-pre-volumes/
mv ~/.local/share/clara/orchestrator ~/.local/share/clara-pre-volumes/
```

The Docker stack writes its control token to
`~/.local/share/clara/docker/orchestrator.token`, so a local install can keep
using `~/.local/share/clara/orchestrator.token` unchanged.

## Pipeline development

Pipeline authors work on the package files directly, then use Clara Lab to see
what the compiler resolves:

```bash
pnpm clara lab                         # preview + probe in a browser
pnpm dev:lab                           # Vite on :5175, lab server on :8791
pnpm clara lab check --target std:software/feature
pnpm clara lab check --json            # CI-friendly diagnostics
```

`check` exits non-zero on compile errors. It ignores warnings, so it can run in
a pre-commit hook or CI without blocking on author feedback. The lab compiles
the files on the host; when the orchestrator runs in a container, enter the host
path under **Files on this machine** and the container mount under **Workspace
inside the orchestrator** in Setup, then run **Check setup**. See
[features/lab.md](features/lab.md).
