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
pnpm clara pair [--local] [--rotate] [--no-qr] [--no-panel]
pnpm clara control
pnpm clara serve [--rotate] [--no-panel]
pnpm clara start [--no-server] [--no-web] [--no-orchestrator] [--build]
pnpm clara stop [--no-server] [--no-web] [--no-orchestrator]
pnpm clara restart [--no-server] [--no-web] [--no-orchestrator] [--build]
pnpm clara status
pnpm clara logs <server|web|orchestrator>
pnpm clara server <start|stop|status|setup-token|pair|admin|logs> [--docker] [--build]
pnpm clara web <start|stop|status|logs> [--docker] [--build]
pnpm clara pass
pnpm clara orchestrator <serve|start|stop|status|token>
pnpm clara rebuild <status|build|adapters|restart|health>
pnpm clara lab [serve|check]
```

Run `pnpm clara --help` for the command list and `pnpm clara <command> --help`
for one command.

`pnpm clara pair` runs the server source directly and does not need a build.
`pnpm clara control` and `pnpm clara serve` use the built agent, so run
`pnpm build` first. `pnpm clara start` is the combined Docker command: it
creates the `clara` network, bootstraps `docker/.env` and the orchestrator token
on first run, then starts the selected services in orchestrator, server, web
order. Disable any part with `--no-server`, `--no-web`, or `--no-orchestrator`;
`restart` stops and recreates the selection. The scoped
`pnpm clara server start --docker` and `pnpm clara orchestrator start --docker`
commands remain available when only one service is wanted; the local
foreground mode remains `pnpm clara serve`.
`pnpm clara web start --docker --build` builds and serves the static SPA on
`127.0.0.1:8080`; `pnpm dev:web` remains the Vite development server. The agent
panel is the one-time harness setup surface; the server does not read OpenCode's
`service.json`. `pnpm clara pass` still reads the OpenCode development password
from `${XDG_STATE_HOME:-~/.local/state}/opencode/service.json` for local
tooling.
`pnpm clara rebuild` snapshots the running services, rebuilds the primary
checkout, installs the adapters, restarts only the captured services, and
verifies their health. The standard `std:maintenance/rebuild` pipeline drives
the same commands one step at a time; see
[features/maintenance.md](features/maintenance.md).

Use these commands instead of calling the workspace scripts directly so that
agents and developers share one command surface.

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
