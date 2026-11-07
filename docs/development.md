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

`better-sqlite3` selects its prebuild from the libc Node reports. Alpine images
that install `gcompat` report a glibc version even though Node runs on musl, so
`patches/better-sqlite3@13.0.3.patch` inspects the loaded interpreter instead.
Keep that patch until the dependency detects gcompat correctly.

## Developer commands

```bash
pnpm clara pair [--local] [--rotate] [--no-qr] [--no-panel]
pnpm clara control
pnpm clara serve [--rotate] [--no-panel]
pnpm clara pass
pnpm clara plugin install [--force]
pnpm clara plugin uninstall [--purge]
pnpm clara ledger <args...>
```

Run `pnpm clara --help` for the command list and `pnpm clara <command> --help`
for one command. Run `pnpm clara ledger help` for the ledger CLI.

`pnpm clara pair` runs the server source directly and does not need a build.
`pnpm clara control` and `pnpm clara serve` use the built agent, so run
`pnpm build` first. `pnpm clara pass` reads the password from
`${XDG_STATE_HOME:-~/.local/state}/opencode/service.json`.

Use these commands instead of calling the workspace scripts directly so that
agents and developers share one command surface.
