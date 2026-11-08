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
3. Before handing a package to an agent, run `pnpm clara lab` to choose the host
   files, read the workspace the service reports, preview the compiled target,
   inspect each rendered prompt and policy, and compare it with a pinned run.
   The same console can then act as the agent and drive the run by hand. See
   [lab.md](lab.md).
4. In OpenCode, run `/pipeline <request>`. The installed command tells the
   agent to call `clara_start` with the full request and the current workspace.
   Any agent with the Clara tools can also call `clara_start` directly. The
   OpenCode adapter records its session as the run origin automatically; a
   generic MCP caller can pass `origin.session_id` explicitly.
5. The service compiles and snapshots the pipeline, creates a run, and returns
   work orders. In conductor mode the adapter dispatches managed workers.
6. Workers report results with `clara_complete`, failures with `clara_fail`,
   router choices with `clara_route`, and dynamic fan-out with `clara_spawn`.
7. The service advances immediately on completion. It opens alerts for
   failures, budget exhaustion, stalls, and needs-input events.
8. The service records the root origin and exposes the run, alerts, and SSE
   events. Automatic delivery of the final result into the origin session is a
   known gap; use `clara_status` or `clara_inbox` until it lands.

## Container deployment

The orchestrator can run as a container on the same Docker network as OpenCode.
That is the preferred setup when the agent itself is containerized.

1. Copy `docker/.env.example` and set:
   - `CLARA_ORCHESTRATION_TOKEN` to a long random token,
   - `CLARA_WORKSPACE` to the absolute path of the repository or workspace.
2. Start the service:

   ```sh
   docker compose -f docker/compose.yml up -d --build orchestrator
   ```

3. Join the OpenCode container to the `clara` network and set:

   ```sh
   CLARA_ORCHESTRATION_URL=http://orchestrator:8789
   CLARA_ORCHESTRATION_TOKEN=<same token>
   CLARA_ORCHESTRATION_WORKSPACE=/workspace/clara
   ```

4. Mount the workspace at the same absolute path in both containers:

   ```text
   -v /absolute/path/to/clara:/workspace/clara
   ```

The compose service sets `CLARA_ORCHESTRATION_WORKSPACE=/workspace/clara`, which
is the path the service reports to Clara Lab. Change it only if you move the
workspace mount. The orchestrator image bakes `lib/std` at
`/opt/clara/lib/std`. A workspace that vendors its own standard library can set
`CLARA_STD_DIR` to its `lib/std`. The orchestrator does not publish a host port;
only the private Docker network can reach it. The database lives in the
`orchestrator-data` volume.

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
5. **One logical conversation.** The root run records its origin session and
   worker sessions stay hidden automation. Results and alerts are available
   through status, the inbox, and SSE; adapters may deliver them into the origin.
6. **Package references are stable.** `std:software` is the package entry;
   `std:software/feature` is a named pipeline. In-flight runs pin the resolved
   snapshot and hash.
7. **Orchestration is independent of Clara management.** The old
   `management.enabled` switch gates only the legacy ledger plugin. The
   orchestration service runs whenever it is installed, the config is active,
   and the service is running.

## Router criteria

Route entries carry the natural-language rule that tells the classifier when to
pick them:

```yaml
router:
  id: classifier
  path: ./routers/classifier.md
  routes:
    - when: content
      criteria: a request to write, draft, edit, or deliver an article, post, essay, or other prose content.
      run: std:content
    - when: software-development
      criteria: a normal software feature, bug, or example request.
      run: std:software
    - when: quick-patch
      criteria: a small, local lifecycle patch with no full spec cycle.
      run: quick_patch
```

The engine renders those entries as a bullet list and substitutes it for
`[ROUTES]` in the router Markdown:

```text
- `software-development` — a normal software feature, bug, or example request.
- `quick-patch` — a small, local lifecycle patch with no full spec cycle.
```

Routers without the placeholder get the list appended under a `## Routes`
heading. `criteria` falls back to the legacy `description` field. The rendered
prompt is part of the pinned run snapshot and the work order.

## Standard software pipelines

The `std:software` package routes feature, bug, and documentation requests to
three strict lifecycles. Feature work runs spec, plan, tests, build, an
independent verification gate, review, and docs. Bug work runs reproduction, a
failing regression test, the smallest fix, verification, review, and docs.
Documentation-only work runs assessment, in-place updates, link and index
verification, and review. Every task step resolves to a Markdown task under
`lib/std/software/tasks`; the loader test fails when a pipeline names a missing
task.

```text
feature: create_spec → plan_implementation → write_tests → build_feature →
         verify_implementation → code_review → update_docs
bug:     identify_bug → write_regression_test → fix_bug → verify_bug_fix →
         code_review → update_docs
docs:    assess_docs → update_docs → verify_docs → docs_review
```

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
  tools, but the Clara control tools (`clara_route`, `clara_complete`,
  `clara_fail`, `clara_spawn`) stay available so the worker can still finish
  or report the failure. The step is marked budget-exceeded and retries may
  receive a larger budget.
- A step is `observed`: policy denials are recorded as `policy.observed`
  events, but tools are not blocked. `strict` and `sandboxed` steps deny and
  count violations.
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
- Token limits depend on harness-reported usage. The OpenCode adapter does not
  report model token usage yet, so token budgets are advisory in that harness;
  turn, tool-call, wall-clock, and attempt limits are exact.
- The OpenCode adapter records the origin session but does not yet push final
  results or alerts into it automatically; use `clara_status` or `clara_inbox`.
- The generic MCP bridge cannot see the harness session ID. Pass
  `origin.session_id` or use an adapter to bind the root session.
- The web Settings catalog still reads the legacy JSON pipelines; the package
  catalog is available through `pnpm clara orchestration` and MCP
  `clara_catalog`.
- The OpenCode adapter dispatches managed workers in the run workspace with a
  dedicated worker agent (`CLARA_WORKER_AGENT`, default `general`), not the
  caller's agent.
- Clara Lab compiles the files on the host. A containerized service with a
  different workspace mount can produce a different preview than the run.

## Technical appendix

<details>
<summary>Commands, packages, data, and references</summary>

- Service: `apps/orchestrator`, loopback REST, SSE, and `/mcp`.
- MCP bridge: `apps/mcp`, stdio, talks to the service over loopback HTTP.
- Engine: `packages/orchestration`; policy: `packages/policy`; shared MCP tools:
  `packages/mcp-server`; OpenCode adapter: `plugins/clara-policy`; developer
  preview and probe: `packages/devtools` and `apps/lab`.
- Standard packages: `lib/std/software`, `lib/std/content`, and
  `lib/std/research`. The research pipeline scopes the question, gathers
  external sources, verifies every material claim against independent dated
  sources, and returns a concise linked Markdown report.
- Primary config: `orchestration/index.yml`.
- Data: `${CLARA_DATA_DIR:-~/.local/share/clara}/orchestration.db` and
  `orchestrator.token`.
- Workspace: `GET /v1/config` reports the service workspace from
  `CLARA_ORCHESTRATION_WORKSPACE` (default: the service's working directory),
  plus `CLARA_STD_DIR` and `CLARA_ORCHESTRATION_CONFIG` when set.
- Container: `docker compose -f docker/compose.yml up -d --build orchestrator`.
- Commands: `pnpm clara orchestration start|stop|status|serve|token`,
  `pnpm clara mcp install|uninstall|config|status`,
  `pnpm clara adapter install opencode|uninstall|status`,
  `pnpm clara lab [serve|check]`.
- OpenCode entry point: `/pipeline <request>` (installed by the MCP and adapter
  installers at `~/.config/opencode/commands/pipeline.md`).
- MCP tools: `clara_start`, `clara_next`, `clara_complete`, `clara_fail`,
  `clara_route`, `clara_spawn`, `clara_status`, `clara_inbox`, `clara_cancel`,
  `clara_tick`, `clara_check`, `clara_usage`, `clara_heartbeat`,
  `clara_catalog`, and the adapter administration tools.
- Package assets: `pipelines/*.yml`, `routers/*.md`, `tasks/*.md`; `index.yml`
  declares the entry, imports, defaults, and can override discovered assets.
  Router routes accept `when`, `run`, and optional `criteria`.
- References: `std:software` (package entry), `std:software/feature`,
  `std:software/bug`, and `std:software/docs` (named pipelines), `std:research`
  (research brief), bare names (same package).
- SSE: `GET /v1/events?since=<event-id>` publishes run, step, policy, and alert
  events for bridge notifications and direct harness subscriptions.
- See [capabilities.md](capabilities.md) for shipped scope.

</details>
