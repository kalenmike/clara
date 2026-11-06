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
