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

From the hub panel, turn on **Settings → Orchestration**. Or run:

```bash
clara start engine
```

The service listens on `127.0.0.1:8789`. Check it with:

```bash
clara status engine --json
```

## Install the adapter

```bash
clara-adapter-opencode install  # or: clara start adapter --harness opencode --pair
```

The command links the OpenCode plugin, installs the `Clara` agent, and installs
the shared runner. Add `--mcp` to register the MCP bridge with the harness. The
OpenCode adapter is included with this release; another harness needs its own
adapter.

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
a run manually. It also reports the workspace the service uses.

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

3. Open Clara Desktop, connect to the hub, and choose **Clara Lab** in the
   sidebar.

The lab service is not a public service. Keep it on a private network or behind
a firewall, and open only the port the hub uses. The hub holds no engine token;
it adds only the shared lab token. To turn the bridge off, set
`CLARA_LAB_URL=off` on the hub.

## Pipelines

Pipelines are YAML and Markdown data. The engine ships with a default
config that routes to the standard packages, so you can start a run without
writing any configuration. To choose your own routing, point
`CLARA_ENGINE_CONFIG` at an `index.yml`; its imports identify the
packages. The service may start with the orchestration switch, or the MCP bridge
may start it on first use. The service owns the workspace and entry point; the
model never passes them.

Clara Lab compiles a package with the same loader as the service, so you can
point it at a local `index.yml`, inspect the resolved steps and prompts, and see
load errors before starting a run. The [developer documentation](/internals/)
includes the complete package and step reference.

## MCP

```bash
clara start adapter --harness opencode --mcp
clara status adapter
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
