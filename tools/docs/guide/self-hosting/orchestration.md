---
title: Orchestration
description: Run optional pipelines, install the adapter, and preview packages.
sidebar_position: 6
---

# Orchestration

Orchestration is optional. It runs package-based pipelines in a local service and
connects them to your harness through an adapter. If you only want Clara's chat
client, skip this page.

The service is the **Clara Engine**; **Orchestration** is the feature. The
client's **Orchestrator mode** setting keeps its historical label for now.

## What it adds

- A loopback engine service that owns run state, leases, budgets, and
  alerts.
- A `Clara` agent in the harness that starts and checks runs. In OpenCode, the
  included adapter installs her as a primary agent.
- Worker sessions for pipeline steps.
- Clara Lab, a workbench in Clara Desktop for previewing packages and driving a
  run by hand. Its service runs next to the engine.
- MCP tools for callers that do not use the adapter.

The hub enables the feature; each client chooses whether to use the engine
surface. Keep the choice on one device, or share it through the isolated
**Orchestrator mode** setting under **Settings → Sync**.

## Start the service

From the hub panel, turn on **Network → Orchestration**. Or run:

```bash
clara start engine
```

The service listens on `127.0.0.1:8789`. Check it with:

```bash
clara status engine --json
```

## Install the adapter

```bash
clara adapter install opencode
```

The command links the OpenCode plugin, installs the `Clara` agent, and enables
the embedded runner on the machine that runs OpenCode. The runner executes
workspace-specific scripts there, while the engine and its run state stay on the
hub host. A panel install does this automatically and does not need an
environment variable.

After the adapter authenticates, the hub tells it where the engine can be
reached. The adapter tests the direct addresses from its own machine and, when
none answer, uses a sealed route through the hub. That route is the same
WebSocket the adapter already uses, so neither Docker nor SSH needs an engine
port, a second relay room, or an engine token on the harness machine. The
resolved endpoint is written to `engine.json` and updated when the adapter
reconnects.

`CLARA_ENGINE_URL`, `CLARA_ENGINE_TOKEN`, and the
`CLARA_ORCHESTRATION_*` names are for CI and development overrides. A normal
panel install should not need them.

Add `--mcp` to register the MCP bridge with the harness. The OpenCode adapter
is included with this release; another harness needs its own adapter. Use
`--no-runner` only when scripts should run through a separate shared runner:

```bash
clara runner start
```

After installation, select the **Clara** agent in OpenCode. She is the
human-facing entry point: a concrete request starts a run, a status question
reads the service, and a greeting does not create work.

## Preview a package

Clara Lab has two parts: a service that runs next to the engine, and the UI in
Clara Desktop. `clara start` runs the service with the rest of the stack; to run
only the service on the engine host:

```bash
clara start lab
```

By default the service listens on `127.0.0.1:8791` and owns the workspace, the
engine token, and the engine's standard packages. The desktop app opens the UI and
reaches the service through your hub, so the hub and engine can be on other
machines.

It compiles a package with the same loader and compiler as the service, shows
the step tree, rendered prompts, policy, budget, and source files, and can drive
a run manually. It also reports the workspace the service uses. Its status bar
labels the UI as `Clara Lab` and shows the version at the far right.

### Remote desktop setup

When the hub and the lab service are on different machines:

1. On the engine host, start the lab service with a bind address and a shared
   token, and allow a remote hub:

   ```bash
   CLARA_LAB_HOST=0.0.0.0 \
   CLARA_LAB_TOKEN=<shared-token> \
   CLARA_LAB_ALLOW_REMOTE=1 \
   clara start lab
   ```

2. On the hub, point the bridge at that service with the same token, then
   restart the hub:

   ```bash
   CLARA_LAB_URL=http://<engine-host>:8791 \
   CLARA_LAB_TOKEN=<shared-token>
   ```

3. Open Clara Desktop, connect to the hub, and choose **Lab** in the app header.

The lab service is not a public service. Keep it on a private network or behind
a firewall, and open only the port the hub uses. The hub holds no engine token;
it adds only the shared lab token. To turn the bridge off, set
`CLARA_LAB_URL=off` on the hub.

## Pipelines

Pipelines are YAML and Markdown data. The engine ships with a default
config that routes to the standard packages, so you can start a run without
writing any configuration. To choose your own routing, add an
`orchestration/index.yml` to the workspace and commit it with the project. The
engine uses that file for runs in the workspace, so one service can route
different projects differently.

```yaml
# <workspace>/orchestration/index.yml
id: workspaces
name: Workspace routing
version: 1
defaults:
  provider: ollama
  model: 'mistral-nemo:12b'
imports:
  std:
    - path: software
router:
  id: classifier
  path: ./routers/classifier.md
  routes:
    - when: software-development
      criteria: a normal software feature, bug, or documentation request.
      run: std:software
```

The config imports the packages it routes to and declares its own entry. Pin
`defaults.provider` and `defaults.model` to keep every step on one model; use
`overrides` to change the model for an imported package without editing it.
Without a pinned model, workers fall back to the harness default, which may not
be what you expect. Restart the engine after editing an existing config file.

If you keep configuration outside the workspace, start the service with
`CLARA_ENGINE_CONFIG` pointing at an `index.yml`; that explicit file wins over
the workspace file. The bundled default applies when neither exists. The service
may start with the orchestration switch, or the MCP bridge may start it on first
use. The service owns the workspace and entry point; the model never passes
them.

Clara Lab compiles a package with the same loader as the service, so it previews
the workspace config, shows the resolved steps and prompts, and reports load
errors before starting a run. The [developer documentation](/internals/)
includes the complete package and step reference.

### Worktree sessions

The default software route runs in a **worktree session**. When the router picks
feature, bug, or documentation work, the engine creates a git worktree beside
your checkout and runs that work there. Your primary checkout stays untouched
until the work is ready.

- The wrapper starts the worktree before the software router chooses a route, so
  every current and future software route is covered.
- Before merging, it reconciles the primary's latest commits into the session
  branch. If that conflicts, it hands the conflict to a separate resolve agent,
  which merges, fixes, tests, and commits inside the worktree. It retries the
  reconcile up to three times.
- After the merge it removes the worktree and deletes the session branch. A
  failed or cancelled run leaves both in place so you can inspect them.
- The work continues on `task/run-<id>`. Worktrees live in a `clara-worktrees`
  directory beside the checkout by default; set `CLARA_WORKTREES_DIR` for the
  engine and runner to use another root.
- The primary checkout must be clean when a session starts and when it merges.

This is ordinary pipeline data, not a hidden feature. The bundled `session`
package defines the `worktree` wrapper, and the default config applies it with
one line on the software import:

```yaml
imports:
  std:
    - path: session
    - path: software
      wrap: std:session/worktree
```

Remove the `wrap` line to run software work directly in the workspace, or point
it at another package to give that package the same guard. Starting a specific
pipeline or package from Clara Lab runs it directly and does not create a
session; preview the top entry to see the wrapper. The package list marks an
imported package with its routed wrap.

### Remote and container workspaces

The engine reads its config from its own workspace path, while workers and
scripts run on the adapter's machine. When a container mount or an SSH host
maps the repository to a different path, the adapter records its path with the
run and uses it for workers. Clara Lab shows the engine workspace and the
worker workspace separately. A worker that cannot start is reported as a step
error and an alert, never as a running router.

## MCP

```bash
clara adapter install opencode --reuse-pairing --mcp
clara adapter status opencode
```

The MCP bridge is a stdio process that talks to the local service. It is useful
for callers that are not the Clara adapter.

## Diagnose a run

```bash
clara-engine analyze --json
clara-engine inspect --run <id> --json
```

An alert or a finished run is delivered back into the Clara session that started
it. A client that uses the engine surface holds worker-session alerts;
other clients receive them normally.

## Related

- [Configuration](configuration.md)
- [Updates and backups](updates.md)
- [Chat and approvals](../chat.md)
