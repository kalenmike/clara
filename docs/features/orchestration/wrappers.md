---
title: Wrappers
kind: reference
---

# Wrappers

A wrapper is a reusable before/after guard for a pipeline. It applies when a
router in one package selects an imported package, so the router stays untouched
and every current or future route is covered. Explicit operator targets (Clara
Lab, REST, `compileRun` targets) are not wrapped, and a package's own routes are
not wrapped a second time.

## Definition

```yaml
# guard/index.yml
id: guard
wrappers:
  worktree:
    workspace: { from: start_session, field: path }
    before:
      - name: start_session
        type: script
        result_mode: json
        command: |
          ...                       # prints {"path": "<worktree>"} only on stdout
    after:
      - name: reconcile
        type: script
        command: |
          ...                       # merge the primary into the session branch
        on_failure:
          max_cycles: 3
          retry: true
          steps:
            - { name: resolve_conflicts, type: agent }
    cleanup:
      - name: remove_session
        type: script
        command: |
          ...
```

```yaml
# root/index.yml
imports:
  std:
    - path: session
    - path: software
      wrap: std:session/worktree
```

`before`, `after`, and `cleanup` are step lists. `workspace` names one `before`
leaf with `from` and reads `field` from its JSON result (default `path`). `name`
and `description` are display only. A wrapper needs at least one step, and a
`workspace` needs at least one before step. An import may name a wrapper with
`wrap: namespace:package/wrapper` or a local wrapper id.

## Scope

`before` and `cleanup` run in the parent workspace. The wrapped target and
`after` run in the resolved workspace, including every router branch, agent
worker, script `cwd` and `CLARA_WORKSPACE`, and artifact existence check. The run
and its claims stay registered to the primary workspace, so the same adapter and
runner serve the session.

The resolved path must be an existing linked git worktree under
`CLARA_WORKTREES_DIR` (default: a `clara-worktrees` directory beside the
workspace). The engine checks the path and its `gitdir:` marker without running
git; an invalid, missing, or out-of-root path fails the scope step before any
worker is dispatched.

Wrappers are not re-entrant: one scope per run. A wrapper target that is a
router keeps its own routes unwrapped. Scripts inside a scope can derive
identity from `CLARA_RUN_ID`; in `result_mode: json`, stdout must be the JSON
value only, so send git and install output to stderr.

## Lifecycle

A successful run removes the worktree in `cleanup`. A failed or cancelled run
leaves it in place for inspection, because there is no `finally` phase yet. A
scope that cannot resolve its workspace fails the scope and the run.

`clara_spawn` is refused inside a scope because child runs would inherit the
primary workspace; use harness subagents in the worker session instead.

## Default software session

The bundled `std:session` package provides the `worktree` wrapper, and the
default config applies it to `std:software`:

```yaml
imports:
  std:
    - path: session
    - path: software
      wrap: std:session/worktree
```

That covers the software router's feature, bug, and documentation routes and any
future route without per-pipeline wiring. The wrapper creates a worktree on
`task/run-<id>`, reconciles the primary into the branch, runs the selected
pipeline there, hands a conflict to a resolve agent for up to three cycles,
merges the branch into the primary, and removes the worktree. Remove the `wrap`
line to run software work directly, or apply it to another import to guard that
package the same way.
