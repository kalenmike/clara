---
title: Orchestration
description: Run optional pipelines, install the adapter, and preview packages.
sidebar_position: 6
---

# Orchestration

Orchestration is optional. It runs package-based pipelines in a local service and
connects them to your harness through an adapter. If you only want Clara's chat
client, skip this page.

## What it adds

- A loopback orchestration service that owns run state, leases, budgets, and
  alerts.
- A `Clara` agent in the harness that starts and checks runs. In OpenCode, the
  included adapter installs her as a primary agent.
- Worker sessions for pipeline steps.
- Clara Lab, a local workbench for previewing packages and driving a run by hand.
- MCP tools for callers that do not use the adapter.

## Start the service

From the hub panel, turn on **Orchestration**. Or run:

```bash
pnpm clara orchestrator start
```

The service listens on `127.0.0.1:8789`. Check it with:

```bash
pnpm clara orchestrator status --json
```

## Install the adapter

```bash
clara-adapter-opencode install  # or: pnpm clara adapter install --opencode
```

The command links the OpenCode plugin, installs the `Clara` agent, and installs
the shared runner. Add `--mcp` to register the MCP bridge with the harness. The
OpenCode adapter is included with this release; another harness needs its own
adapter.

After installation, select the **Clara** agent in OpenCode. She is the
human-facing entry point: a concrete request starts a run, a status question
reads the service, and a greeting does not create work.

## Preview a package

```bash
pnpm clara lab
```

Clara Lab opens on `127.0.0.1:8791`. It compiles a package with the same loader
and compiler as the service, shows the step tree, rendered prompts, policy,
budget, and source files, and can drive a run manually. It also reports the
workspace the service uses.

`pnpm clara lab check --workspace . --target std:software/feature` validates a
target for CI.

## Pipelines

Pipelines are YAML and Markdown data. The orchestrator ships with a default
config that routes to the standard packages, so you can start a run without
writing any configuration. To choose your own routing, point
`CLARA_ORCHESTRATION_CONFIG` at an `index.yml`; its imports identify the
packages. The service may start with the orchestration switch, or the MCP bridge
may start it on first use. The service owns the workspace and entry point; the
model never passes them.

Clara Lab compiles a package with the same loader as the service, so you can
point it at a local `index.yml`, inspect the resolved steps and prompts, and see
load errors before starting a run. The [developer documentation](/internals/)
includes the complete package and step reference.

## MCP

```bash
pnpm clara mcp install
pnpm clara mcp config
pnpm clara mcp status
```

The MCP bridge is a stdio process that talks to the local service. It is useful
for callers that are not the Clara adapter.

## Diagnose a run

```bash
pnpm clara orchestrator analyze --json
pnpm clara orchestrator inspect --run <id> --json
```

An alert or a finished run is delivered back into the Clara session that started
it. Worker sessions stay out of the mailbox and appear in the Workers drawer.

## Related

- [Configuration](configuration.md)
- [Updates and backups](updates.md)
- [Chat and approvals](../chat.md)
