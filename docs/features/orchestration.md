# Orchestration

## Summary

Clara orchestration is a local service and MCP bridge that runs package-based
pipelines without taking over the harness's agent loop. A pipeline is YAML and
Markdown data under `lib/std` or the workspace; the service owns run state,
leases, transitions, budgets, and alerts, while a thin harness adapter executes
work orders, enforces strict policy, and carries results back to the
human-facing Clara agent.

## User flow

1. Start the service with `pnpm clara orchestration start`, or let the MCP
   bridge start it on first use.
2. Install the OpenCode strict adapter with
   `pnpm clara adapter install opencode`. The adapter installs the `clara`
   agent and removes the old adapter-generated `/pipeline` command.
3. Before handing a package to an agent, run `pnpm clara lab` to choose the host
   files, read the workspace the service reports, preview the compiled target,
   inspect each rendered prompt and policy, and compare it with a pinned run.
   The same console can then act as the agent and drive the run by hand. See
   [lab.md](lab.md).
4. In OpenCode, select the **Clara** agent. She is the human-facing interface,
   not a pipeline worker:
   - a concrete new-work request calls `clara_start` and replies with the run id;
   - a status question reads `clara_list`, `clara_inbox`, or `clara_status`;
   - a greeting, thanks, or general question is answered without a run;
   - an ambiguous request gets one clarifying question.

   The agent has no read, edit, shell, network, or subagent tools, so it cannot
   do pipeline work itself.

5. The service compiles and snapshots the pipeline, creates a run, and returns
   work orders. In conductor mode the adapter dispatches the first work order to
   a managed worker session and records the calling session as the run origin.
6. Workers report results with `clara_complete`, failures with `clara_fail`,
   router choices with `clara_route`, and dynamic fan-out with `clara_spawn`.
7. The service advances immediately on completion. It opens alerts for
   failures, budget exhaustion, and stalls.
8. The adapter delivers new alerts and finished root runs back into the origin
   session as queued synthetic prompts. Clara reads the run or alert, tells the
   human what happened, and waits for a decision. She does not poll.
9. A generic MCP caller that does not use the adapter is in manual work-order
   mode: `clara_start` returns a work order, and the caller executes it. The
   MCP installer keeps a separate `/pipeline` command for that path.

## Clara agent

The adapter installs `~/.config/opencode/agents/clara.md` as a primary agent.
She is the expected entry point in OpenCode.

Her default is read-first:

- A concrete new-work request creates one run and stops with the run id.
- A status question reads the orchestrator and answers from it.
- A greeting, thanks, or general question never creates a run.
- An ambiguous request gets one clarifying question.
- An answer to an alert resolves or cancels the alert, not a new run.

The agent has only `clara_start`, `clara_status`, `clara_list`, `clara_inbox`,
`clara_ack`, `clara_cancel`, and `clara_catalog`. The worker tools and every
repository tool are denied by permissions, not just by the prompt. The adapter
also refuses `clara_start` from any other agent, so a build session cannot
silently become a second interface. If an answer needs repository context, the
agent treats it as work and asks before starting a run.

The adapter delivers new alerts and finished root runs into the same session as
queued synthetic prompts. The agent reports the result or decision and waits.
This is the same pattern as the legacy ledger's attention delivery.

## Container deployment

The orchestrator can run as a container on the same Docker network as OpenCode.
That is the preferred setup when the agent itself is containerized.

1. Copy `docker/.env.example` and set:
   - `CLARA_ORCHESTRATION_TOKEN` to a long random token,
   - `CLARA_WORKSPACE` to the absolute path of the repository or workspace,
   - `CLARA_DATA_DIR` to the host directory that stores the database and token.
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
`CLARA_STD_DIR` to its `lib/std`. Compose publishes the port on host loopback
only (`127.0.0.1:8789:8789`) so host tools such as
`pnpm clara orchestration status` and Clara Lab can reach the container. The
database and token live under the host `CLARA_DATA_DIR` mount.

The container writes no host PID file. `pnpm clara orchestration status` reports
`running (docker container)`, and `pnpm clara orchestration stop` does not
signal anything; stop the container with `pnpm docker:orchestrator:down` or
`pnpm clara orchestration stop --docker`.

Start it from the host with `pnpm clara orchestration start --docker`. That runs
`docker compose -f docker/compose.yml up -d orchestrator` and waits for
`/health` to report a container. Add `--build` to rebuild the image first. If a
local instance is already running, the command refuses and asks you to stop it
first.

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
   worker sessions stay hidden automation. The OpenCode adapter delivers new
   alerts and finished root runs into the origin session; the inbox and SSE
   remain the read-only fallback.
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

## Models and providers

Every dispatched step carries a model and the provider that owns it. The
service does not call a model, but it must preserve both so the harness can pin
the worker session.

```yaml
defaults:
  provider: opencode-go
  model: deepseek-v4.1-flash

pipelines:
  feature:
    default_provider: opencode-go
    default_model: deepseek-v4.1-flash
    steps:
      - name: create_spec
        type: task
        provider: opencode-go
        model: deepseek-v4.1-flash
```

Resolution runs from the package manifest (`defaults.provider` /
`defaults.model`) through the pipeline (`default_provider` / `default_model`)
to the step or task (`provider` / `model`). A step may override only one half;
the other is inherited. Work orders expose both fields, and an entry router
inherits the package defaults so router classification uses the same model as
the pipeline it selects.

The OpenCode adapter creates managed worker sessions with
`{ providerID, id }` from the work order, switches the worker agent, then pins
the model again so an agent-level model cannot override the pipeline. A step
without a model falls back to the harness default, which the lab flags as a
warning.

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
- The origin session is archived, missing, or no longer uses the Clara agent:
  the result stays in the inbox and the adapter does not prompt that session.
- The package tree changes mid-run: the pinned snapshot still applies.
- The service restarts with ready work: the outbox and step state restore the
  next work order; no watchdog tick is required to advance healthy work.
- The adapter restarts with active runs: it adopts non-terminal runs for its
  workspace, so dispatch and delivery resume without a new user request.
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
- A step declares a model without a provider: the lab reports
  `model_provider_missing`; the adapter refuses to silently pin a provider and
  logs an incomplete model reference instead.
- A model or provider does not exist in the running OpenCode catalog: the lab
  reports `model_unknown` (and `model_disabled` for disabled models) before the
  run starts.

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
- There is no needs-input tool yet. A worker can fail, but it cannot pause and
  ask the human a question mid-step.
- Delivery targets the Clara agent (`CLARA_INTERFACE_AGENT`, default `clara`).
  A run started from another agent leaves its alerts in the inbox.
- Multiple OpenCode adapters registered for the same workspace would both adopt
  active runs. Run one adapter per workspace.
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
- Data: `${CLARA_DATA_DIR:-~/.local/share/clara}/orchestration.db`,
  `orchestrator.token`, and `policy-delivery.json` (adapter delivery cursor).
- Workspace: `GET /v1/config` reports the service workspace from
  `CLARA_ORCHESTRATION_WORKSPACE` (default: the service's working directory),
  plus `CLARA_STD_DIR` and `CLARA_ORCHESTRATION_CONFIG` when set.
- Container: `docker compose -f docker/compose.yml up -d --build orchestrator`.
- Commands:
  `pnpm clara orchestration start [--docker] [--build]|stop [--docker]|status|serve|token`,
  `pnpm clara mcp install|uninstall|config|status`,
  `pnpm clara adapter install opencode|uninstall|status`,
  `pnpm clara lab [serve|check]`. Running `pnpm clara orchestration` without a
  subcommand prints help instead of starting the service.
- OpenCode entry point: the `clara` agent at
  `~/.config/opencode/agents/clara.md`, installed by the adapter. The MCP-only
  path keeps a manual `/pipeline` command at
  `~/.config/opencode/commands/pipeline.md`.
- Adapter delivery: non-terminal runs are adopted at startup. New alerts and
  finished root runs are queued into origins whose agent is
  `CLARA_INTERFACE_AGENT` (default `clara`). The delivery cursor is
  `policy-delivery.json`; a missing file is treated as a fresh install, so
  historical terminal runs are not replayed.
- MCP tools: `clara_start`, `clara_next`, `clara_complete`, `clara_fail`,
  `clara_route`, `clara_spawn`, `clara_status`, `clara_inbox`, `clara_cancel`,
  `clara_tick`, `clara_check`, `clara_usage`, `clara_heartbeat`,
  `clara_catalog`, and the adapter administration tools.
- Package assets: `pipelines/*.yml`, `routers/*.md`, `tasks/*.md`; `index.yml`
  declares the entry, imports, defaults, and can override discovered assets.
  Defaults accept `provider`, `model`, `task_dir`, and `enforcement`; pipelines
  accept `default_provider` / `default_model`; steps and tasks accept
  `provider` / `model`. Router routes accept `when`, `run`, and optional
  `criteria`.
- References: `std:software` (package entry), `std:software/feature`,
  `std:software/bug`, and `std:software/docs` (named pipelines), `std:research`
  (research brief), bare names (same package).
- SSE: `GET /v1/events?since=<event-id>` publishes run, step, policy, and alert
  events for bridge notifications and direct harness subscriptions.
- See [capabilities.md](capabilities.md) for shipped scope.

</details>
