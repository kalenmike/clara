# Orchestration

## Summary

Clara orchestration is a local service and MCP bridge that runs package-based
pipelines without taking over the harness's agent loop. A pipeline is YAML and
Markdown data under `lib/std` or the workspace; the service owns run state,
leases, transitions, budgets, and alerts, while a thin harness adapter executes
work orders and enforces strict policy.

## User flow

1. Start the service with `pnpm clara orchestration start`, or let the MCP
   bridge start it on first use.
2. Install the generic MCP entry with `pnpm clara mcp install`, or install the
   OpenCode strict adapter with `pnpm clara adapter install opencode`.
3. Submit a request from the primary session. The agent calls `clara_start`
   with the prompt and workspace.
4. The service compiles and snapshots the pipeline, creates a run, and returns
   work orders. In conductor mode the adapter dispatches managed workers.
5. Workers report results with `clara_complete`, failures with `clara_fail`,
   router choices with `clara_route`, and dynamic fan-out with `clara_spawn`.
6. The service advances immediately on completion. It opens alerts for
   failures, budget exhaustion, stalls, and needs-input events.
7. The primary session receives the final result, failure, or question in the
   same conversation. If the origin session is gone, the result stays in the
   inbox and the adapter opens a new user-facing session.

## Core business rules

1. **Packages are data.** The engine has no built-in software pipeline. A
   package is a directory with `index.yml` plus auto-discovered
   `pipelines/*.yml`, `routers/*.md`, and `tasks/*.md`.
2. **State is event-driven.** A completion, failure, route, or spawn triggers
   the next transition in one transaction. The watchdog only repairs expired
   leases, missing heartbeats, restart gaps, and deadline breaches.
3. **Strict enforcement needs an adapter.** `enforcement: strict` fails closed
   unless a live adapter with the required capabilities is registered. MCP alone
   cannot enforce native tool policy.
4. **Leases own work.** Every work order carries a token. Completion, failure,
   routing, and spawn require the matching lease. A second worker cannot close
   the same step.
5. **The user gets one conversation.** The primary session is the conductor.
   Worker sessions are hidden automation; their questions and results bubble to
   the root run's origin.
6. **Package references are stable.** `std:software` is the package entry;
   `std:software/feature` is a named pipeline. In-flight runs pin the resolved
   snapshot and hash.

## Edge cases

- A strict run starts with no adapter: it is refused with
  `enforcement_unavailable`, never downgraded silently.
- A router selects an unknown route: the step is rejected and the run fails.
- A worker disappears: its lease expires, the watchdog marks it retried or
  failed, and the alert reaches the origin session.
- A background child fails: the group fails fast, siblings are cancelled, and
  the group's retry or escalation policy applies.
- A spawned batch succeeds: the parent step records the child results and the
  pipeline continues without a second model turn.
- The origin session is archived or missing: the result stays in the inbox and
  the adapter creates a new user-facing session.
- The package tree changes mid-run: the pinned snapshot still applies.
- The service restarts with ready work: the outbox and step state restore the
  next work order; no watchdog tick is required to advance healthy work.
- A worker exceeds its turn/tool/token budget: policy checks deny further
  tools, the step is marked budget-exceeded, and retries may receive a larger
  budget.
- A workspace has no `orchestration/index.yml`: start fails with a clear config
  error instead of guessing a pipeline.

## Out of scope

- The service calling a model, creating a session, or spawning a process.
- MCP-only strict enforcement without a harness adapter or sandbox.
- A visual pipeline editor; YAML and Markdown are the authoring surface.
- Remote access to the orchestrator; it binds loopback only.
- More than one PSK or token model for the orchestrator.

## Known gaps

- The OpenCode adapter is the first strict adapter. Other harnesses can use the
  generic MCP surface in observed mode or implement the adapter protocol.
- Token limits depend on harness-reported usage; turn, tool-call, wall-clock, and
  attempt limits are exact.
- The web Settings catalog still reads the legacy JSON pipelines; the package
  catalog is available through `pnpm clara orchestration` and MCP
  `clara_catalog`.
- The OpenCode adapter dispatches managed workers through the current agent;
  a dedicated worker agent is a follow-up.

## Technical appendix

<details>
<summary>Commands, packages, data, and references</summary>

- Service: `apps/orchestrator`, loopback REST, SSE, and `/mcp`.
- MCP bridge: `apps/mcp`, stdio, talks to the service over loopback HTTP.
- Engine: `packages/orchestration`; policy: `packages/policy`; shared MCP tools:
  `packages/mcp-server`; OpenCode adapter: `plugins/clara-policy`.
- Standard packages: `lib/std/software` and `lib/std/content`.
- Primary config: `orchestration/index.yml`.
- Data: `${CLARA_DATA_DIR:-~/.local/share/clara}/orchestration.db` and
  `orchestrator.token`.
- Commands: `pnpm clara orchestration start|stop|status|serve|token`,
  `pnpm clara mcp install|uninstall|config|status`,
  `pnpm clara adapter install opencode|uninstall|status`.
- MCP tools: `clara_start`, `clara_next`, `clara_complete`, `clara_fail`,
  `clara_route`, `clara_spawn`, `clara_status`, `clara_inbox`, `clara_cancel`,
  `clara_tick`, `clara_check`, `clara_usage`, `clara_heartbeat`,
  `clara_catalog`, and the adapter administration tools.
- Package assets: `pipelines/*.yml`, `routers/*.md`, `tasks/*.md`; `index.yml`
  declares the entry, imports, defaults, and can override discovered assets.
- References: `std:software` (package entry), `std:software/feature` (named
  pipeline), bare names (same package).
- SSE: `GET /v1/events?since=<event-id>` publishes run, step, policy, and alert
  events for bridge notifications and direct harness subscriptions.
- See [capabilities.md](capabilities.md) for shipped scope.

</details>
