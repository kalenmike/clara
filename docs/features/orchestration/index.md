---
title: Orchestration
---

# Orchestration

## Summary

Orchestration is Clara's package-based pipeline feature. A pipeline is YAML and
Markdown data that ships with the engine as its default, or comes from a custom
config file; it runs step by step without taking over the harness's agent loop.

The **engine** is the service (`@clara/engine`, `clara-engine`, the
`clara-engine` container). It owns run state, leases, transitions, budgets, and
alerts, and it is deterministic: never an LLM, never an agent. **Orchestration**
names the feature, the package domain, and the pipeline vocabulary, never a
process. `CLARA_ORCHESTRATION_*` is a compatibility name for one release.

## User flow

1. Start the service from the hub panel's **Orchestration** switch, with
   `clara start engine`, or let the MCP bridge start it on first use.
2. Install the adapter and shared runner with
   `clara adapter install opencode --pair <code>`. `--mcp` registers the MCP
   bridge, `--no-runner` skips runner config, and `--no-service` writes config
   without a user service. One host and workspace share one runner.
3. Preview a package in Clara Lab: choose host files, read the workspace the
   engine reports, compile the target, inspect rendered prompts and policy, then
   drive the run by hand. See [lab.md](lab.md).
4. Select the **Clara** agent in the harness. She is the human interface, not a
   worker: new work calls `clara_start` and replies with the run id, a status
   question reads the engine, small talk creates no run, and an ambiguous
   request gets one question.
5. The engine compiles the pipeline, pins the snapshot, creates the run, and
   returns work orders. In conductor mode the adapter dispatches the first order
   to a managed worker session and records the calling session as the run origin.
6. Workers report with `clara_complete`, `clara_fail`, `clara_route`, and
   `clara_spawn`, always carrying the work token from their lease.
7. The engine advances the run immediately and opens alerts for failures,
   exhausted budgets, and stalls.
8. The adapter claims a terminal run or alert, then queues it into the origin
   session as a synthetic prompt; the claim is persisted first and released if
   the prompt fails. A finished root run wakes its origin exactly once. Clara
   reports it and waits for a decision.
9. A generic MCP caller that does not use the adapter stays in manual
   work-order mode: `clara_start` returns an order and the caller executes it.

## Core business rules

1. **Packages are data.** The engine ships its standard packages as files and
   has no built-in software pipeline. A package is a directory with `index.yml`
   plus auto-discovered pipelines, routers, agents, and scripts.
2. **The engine owns state and workspace, not execution.** It never calls a
   model, creates a session, or spawns a process. A completion, failure, route,
   or spawn advances the pipeline in one transaction. `CLARA_ENGINE_WORKSPACE`
   sets where workers and scripts run, and every run starts at the active
   config's `entry`; model-facing `clara_start` takes only the request.
3. **Leases own work.** Renewal, completion, failure, routing, and spawn require
   the token from the work order, so a second worker cannot keep or close the
   same step.
4. **Strict enforcement needs a live adapter.** `enforcement: strict` fails
   closed with `enforcement_unavailable` unless a registered adapter holds the
   required capabilities. MCP alone cannot enforce native tool policy.
5. **One conversation, one local instance.** The root run records its origin
   session and worker sessions stay hidden automation. The panel's
   Orchestration switch keeps `orchestration.enabled` in the hub database and
   controls a local engine only; one started from the CLI or MCP bridge is
   detected and left alone.

## Read next

| Document                         | Read when…                                                      |
| -------------------------------- | --------------------------------------------------------------- |
| [packages.md](packages.md)       | You are writing or changing a package, pipeline, step, or model |
| [execution.md](execution.md)     | You are working on a run, lease, runner, or worker prompt       |
| [maintenance.md](maintenance.md) | You are rebuilding, recovering, or diagnosing a Clara setup     |
| [lab.md](lab.md)                 | You are previewing or hand-driving a package                    |

## Edge cases

- A custom config path is missing: startup fails with a clear config error
  instead of guessing; without one, the bundled default is used.
- The package tree changes mid-run: the pinned snapshot and hash still apply.
- The service restarts with ready work: persisted step state restores the next
  work order without waiting for a watchdog tick.
- The adapter restarts with active runs: it adopts non-terminal runs for its
  workspace, so dispatch and delivery resume without a new request.
- The origin session is archived, missing, or no longer runs the Clara agent:
  the result stays in the inbox and no prompt is queued.
- Several adapters are registered for one workspace: each adopts the same runs,
  so run one adapter per workspace.
- A worker exceeds a budget: budgets are hard caps in every enforcement mode,
  control tools stay available, and an over-budget completion is kept rather
  than discarded. See [execution.md](execution.md).

## Out of scope

- The engine calling a model, creating a session, or spawning a process.
- MCP-only strict enforcement without an adapter or sandbox.
- A visual pipeline editor; YAML and Markdown are the authoring surface.
- Remote access to the engine; it binds loopback only.
- More than one token model for the engine.

## Known gaps

- The OpenCode adapter is the first strict adapter. Other harnesses can use the
  generic MCP surface in observed mode or implement the adapter protocol.
- A worker cannot pause and ask the human a question mid-step; it can only
  finish or fail.
- Delivery targets `CLARA_INTERFACE_AGENT` (default `clara`). A run started from
  another agent leaves its alerts in the inbox.
- The web Settings page does not show the package catalog; use Clara Lab,
  `clara status lab --check`, or MCP `clara_catalog`.

## Technical appendix

<details>
<summary>Commands, entry points, and packages</summary>

- Service: `apps/engine`, loopback REST, SSE, and `/mcp` on `127.0.0.1:8789`
  with a bearer token. Data and token live under `CLARA_DATA_DIR` (default
  `~/.local/share/clara`): `engine.db`, `engine.token`, and
  `policy-delivery.json`.
- Packages: `packages/orchestration/engine` (loader, runtime, std packages),
  `packages/orchestration/policy` (step policy and budgets),
  `packages/orchestration/control` (service paths and health),
  `packages/orchestration/mcp` (shared tools and stdio bridge),
  `packages/adapters/runner` (script runner), and
  `packages/adapters/binding` (adapter delivery and usage).
- CLI: `clara start|stop|restart|status|logs engine`,
  `clara adapter install|upgrade|verify|remove <kind> [--mcp]`,
  `clara start runner [--workspace <path>] [--label <name>]`,
  `clara start lab`, and `clara status lab --check`.
- Workspace: `GET /v1/config` reports the workspace from
  `CLARA_ENGINE_WORKSPACE` (default: the service working directory), the active
  `configSource` (`bundled` or `file`), and `configPath`.
- MCP tools: `clara_start`, `clara_next`, `clara_complete`, `clara_fail`,
  `clara_route`, `clara_spawn`, `clara_status`, `clara_attempts`, `clara_inbox`,
  `clara_ack`, `clara_cancel`, `clara_tick`, `clara_check`, `clara_usage`,
  `clara_heartbeat`, and `clara_catalog`.
- Entry point: the `clara` agent at `~/.config/opencode/agents/clara.md`. The
  MCP-only path keeps a manual `/pipeline` command.
- Delivery: `POST /v1/runs/:id/delivery/claim` and
  `POST /v1/runs/:id/delivery/release` reserve and return a terminal run and its
  alerts; claims persist in the database, so restarts cannot re-send a run.
- See [capabilities.md](../capabilities.md) for shipped scope and
  [../architecture/overview.md](../../architecture/overview.md) for where the
  engine sits.

</details>
