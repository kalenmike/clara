# Orchestration

## Summary

Clara orchestration is a local service and MCP bridge that runs package-based
pipelines without taking over the harness's agent loop. A pipeline is YAML and
Markdown data bundled with the engine as its default, or supplied by a custom
config file; the service owns run state, leases, transitions, budgets, and
alerts, while a thin harness adapter executes work orders, enforces strict
policy, and carries results back to the human-facing Clara agent.

**Naming:** the service is the **Clara Engine** (formerly the orchestrator).
**Orchestration** is the feature, package domain, and pipeline vocabulary, not a
process. The engine is deterministic and is never an LLM or an agent.
`CLARA_ORCHESTRATION_*` remains a compatibility name for one release.

See [orchestration-dsl.md](orchestration-dsl.md) for the complete package and
step reference.

## User flow

1. Start the service from the hub panel's **Orchestration** switch, with
   `clara start engine`, or let the MCP bridge start it on first
   use.
2. Install the harness adapter and the shared runner with
   `clara-adapter-opencode install --pair <code>` (or `clara adapter install opencode --pair <code>` in the repository). The command installs the
   hub-facing adapter, links the plugin,
   installs the `clara` agent, disables the plugin's embedded runner, writes the
   shared runner config, and installs a user service where the platform
   supports one. Add `--mcp` to register the MCP bridge with the selected
   harness, or `--no-service` to run the runner in the foreground. Multiple
   harness flags are additive; on one host and workspace they share one runner.
3. Before handing a package to an agent, run `clara start lab` to choose the host
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

   The engine owns the workspace and its configured entry point.
   `clara_start` takes only the request; the model never passes a workspace or
   a target. Executors pass a `capabilities` filter so a script step is left
   for a capable runner instead of the agent adapter.

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
   session as queued synthetic prompts. Before queueing a wake, it asks the
   engine to claim the run or alert; the claim is persisted before the
   prompt and released if the prompt fails. A finished root run therefore wakes
   the origin exactly once even when several adapter instances, or overlapping
   poll cycles, see the same transition. Clara reads the run or alert, tells the
   human what happened, and waits for a decision. She does not poll.
9. A generic MCP caller that does not use the adapter is in manual work-order
   mode: `clara_start` returns a work order, and the caller executes it. The
   MCP installer keeps a separate `/pipeline` command for that path.

## Clara agent

The adapter installs `~/.config/opencode/agents/clara.md` as a primary agent.
She is the expected entry point in OpenCode.

Her default is read-first:

- A concrete new-work request creates one run and stops with the run id.
- A status question reads the engine and answers from it.
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
queued synthetic prompts. The engine is the source of truth for delivery:
the adapter claims the terminal run and its alerts before it awaits the prompt,
and releases the claim if the prompt fails. The local delivery cycle is also
serialized, so overlapping polls or several OpenCode locations loading the same
plugin cannot queue the same completion twice. The agent reports the result or
decision and waits.
The origin session stays the one actionable conversation while workers remain
hidden automation.

## Container deployment

The engine can run as a container on the same Docker network as the harness
and the hub. That is the preferred setup when the hub itself is
containerized. `clara start` brings up the engine, hub, and
web client together; the steps below cover the engine-only path.

The hub uses `infra/docker/server.compose.yml`, joins the same external `clara`
network, and reaches the engine at `http://engine:8789`. The
engine container is named `clara-engine`.

1. Copy `infra/docker/.env.example` and set:
   - `CLARA_ENGINE_TOKEN` to a long random token,
   - `CLARA_WORKSPACE` to the absolute path of the repository or workspace.
     The database and token default to the `clara-orchestrator-data` volume. Set
     `CLARA_ORCHESTRATOR_DATA_DIR` to an absolute host path only when you want a
     bind mount instead.
2. Start the service:

   ```sh
   docker compose -f infra/docker/engine.compose.yml up -d --build engine
   ```

   `clara stop engine --docker` does not need the token or workspace
   exported in the shell: `down` fills the required compose variables with
   absolute placeholders before Compose interpolates the file.

3. Join the harness container to the `clara` network and set:

   ```sh
   CLARA_ENGINE_URL=http://engine:8789
   CLARA_ENGINE_TOKEN=<same token>
   CLARA_ENGINE_WORKSPACE=/workspace/clara
   ```

4. Mount the workspace at the same absolute path in both containers:

   ```text
   -v /absolute/path/to/clara:/workspace/clara
   ```

5. Start the hub container on the same network:

   ```sh
   clara start hub --docker --build
   node apps/hub/server/dist/index.js setup --password-stdin
   ```

   In its panel, use `http://opencode:4096` when the harness is a container on the
   `clara` network. The engine URL is set with
   `CLARA_ENGINE_HOST=engine` and port `8789`.

   `clara start hub --docker` loads `infra/docker/.env` when the file exists.
   If the hub uses the relay, set `CLARA_RELAY_ROOM` to a fixed value: pairing
   codes are scoped to the room, and a changed room makes clients connect to an
   empty room (`hub offline`) until they pair again.

6. Optionally serve the web client from the same Docker host:

   ```sh
   clara start web --docker --build
   ```

   Open `http://127.0.0.1:8080`. The pairing code decides local vs relay; the
   panel Web URL defaults to this container. Set **Web URL** in the hub panel
   for a remote deployment (`CLARA_PAIRING_BASE_URL` overrides it), and set
   `VITE_CLARA_WS_URL` in `infra/docker/.env` and rebuild only when the browser must
   use a different relay endpoint than the hub. The web container is static
   and does not proxy harness traffic.

The compose service sets `CLARA_ENGINE_WORKSPACE=/workspace/clara`, which
is the path the service reports to Clara Lab. Change it only if you move the
workspace mount. The engine image bundles the standard packages inside the
built service, so the container does not mount or copy the standard packages
separately. Compose publishes the port on host loopback only
(`127.0.0.1:8789:8789`) so host tools such as
`clara status engine` and Clara Lab can reach the container. The
database and container token live in the `clara-orchestrator-data` volume.
`clara start` writes a host copy of the token to
`~/.local/share/clara/docker/engine.token` for Lab, the MCP bridge, and
`clara rebuild`. That Docker control directory is separate from the local
install token at `~/.local/share/clara/engine.token`.

The container writes no host PID file. `clara status engine` reports
`running (docker container)`, and `clara stop engine` does not
signal anything; stop the container with
`clara stop engine --docker`. Stopping does not require the
`CLARA_ENGINE_TOKEN` or `CLARA_WORKSPACE` variables: compose still parses
them for `down`, so the command supplies inert values when they are not
exported. It also runs `docker compose down` when the container is unhealthy or
already stopped, so a crashed container can be cleaned up.

Start it from the host with `clara start engine --docker`. That runs
`docker compose -f infra/docker/engine.compose.yml up -d engine` and waits for
`/health` to report a container. Add `--build` to rebuild the image first. If a
local instance is already running, the command refuses and asks you to stop it
first.

Archive the Docker state with `clara stop` followed by
`clara backup`; restore with `clara restore <archive> --force` while
the stack is stopped. These commands only touch the named volumes, never a local
install's host directories. See
[development.md](../development.md#local-and-docker-state) for the state map and
the one-time migration.

## Core business rules

1. **Packages are data.** The engine ships its standard packages as data, not
   code constants, and has no built-in software pipeline. A package is a
   directory with `index.yml` plus auto-discovered `pipelines/*.yml`,
   `routers/*.md`, `agents/*.md`, and `scripts/*.yml`.
2. **State is event-driven.** A completion, failure, route, or spawn triggers
   the next transition in one transaction. The watchdog only repairs expired
   leases, silent workers, restart gaps, and deadline breaches, and it feeds
   every repair through the same transition instead of writing run state
   directly.
3. **Strict enforcement needs an adapter.** `enforcement: strict` fails closed
   unless a live adapter with the required capabilities is registered. MCP alone
   cannot enforce native tool policy.
4. **Leases own work.** Every work order carries a token. Renewal, completion,
   failure, routing, and spawn require the matching lease. A second worker
   cannot keep or close the same step.
5. **One logical conversation.** The root run records its origin session and
   worker sessions carry automation metadata for the dedicated engine
   surface. The OpenCode adapter delivers new alerts and finished root runs into
   the origin session; the inbox and SSE remain the read-only fallback.
6. **The engine owns the workspace and entry.** `CLARA_ENGINE_WORKSPACE`
   configures the run workspace, defaulting to the service working directory.
   Every run starts at the `entry` declared by the active config: the bundled
   default, or the `index.yml` named by `CLARA_ENGINE_CONFIG` (or the
   Lab's `--config`). Model-facing `clara_start` takes only the request; the
   capability filter is internal to the executor. Explicit package references
   such as `std:software/feature` are reserved for the Lab, operator REST calls,
   and tests. In-flight runs pin the resolved snapshot and hash. Run lists, run
   status, and every MCP run payload omit the pinned tree; the full step prompt,
   policy, limits, result, and lease are read only from the Lab's dedicated
   endpoints.
7. **The panel controls the local service.** The **Orchestration** switch keeps
   `orchestration.enabled` in the hub database and starts or stops a local
   instance. A service started from the CLI, MCP bridge, or Docker is detected
   but left under its own management. Clients receive the effective health state
   as `orchestration`; each client then chooses whether to use the engine
   surface, and only opted-in devices hold worker alerts.
8. **Diagnosis is evidence-first.** The `std:diagnostics` package runs a
   deterministic analyzer over run history, then interprets the report. The
   analyzer prefers the live service, falls back to a read-only database open,
   and never mutates state. The pipeline reports findings and proposed fixes; it
   does not apply them.
9. **Maintenance restores the captured setup.** The `std:maintenance` package
   snapshots which services and adapters were running, rebuilds the checkout,
   and restarts only that set. The engine is restarted last, and a restart
   journal makes a retry resume instead of repeating the rebuild.

## Leases and heartbeats

A claim returns a work token and a lease. While a step runs, the adapter renews
the lease every ten seconds; Clara Lab does the same for work it holds. Renewal
requires the current work token, so an abandoned attempt cannot keep a retried
step alive. The model never heartbeats itself, and a long turn or tool call does
not look like a stall.

The watchdog runs every ten seconds. An agent, router, or script step whose heartbeat is
older than `CLARA_ENGINE_STALLED_MS` (default five minutes) or whose lease
expired is requeued while attempts remain, or failed with a `stalled` alert. The
timeout detects a harness that stopped reporting, not model latency. A failure
is handed back to the normal transition, so the run and every ancestor step
settle together.

A managed worker that loses its lease is stopped immediately. A fallback binding
of the parent session only detaches, so a retry never interrupts the human's
conversation.

## Step types

A step declares one of five types:

| Type       | Executor        | Input                         | Output                  | Model |
| ---------- | --------------- | ----------------------------- | ----------------------- | ----- |
| `agent`    | harness adapter | rendered prompt and inputs    | text or JSON result     | yes   |
| `router`   | harness adapter | router prompt and request     | one route key           | yes   |
| `script`   | runner          | declared command and inputs   | stdout, exit code, JSON | no    |
| `pipeline` | engine          | referenced or inline children | child results           | no    |
| `group`    | engine          | inline children               | child results           | no    |

`agent` replaced the old `task` name. A package stores prompts under
`agents/<name>.md`; the step resolves `agents/<step name>.md` by default, or the
document named by `agent:`.

A `script` step is deterministic. It is never sent to a model, it has no prompt,
model, provider, turn budget, or token budget, and it completes from its exit
code:

```yaml
steps:
  - name: build
    type: script
    command: pnpm build --json
    timeout_seconds: 900
    result_mode: json
    success_codes: [0]
```

A step may instead name a reusable script asset under the package's `scripts/`:

```yaml
steps:
  - name: build
    type: script
    script: build
```

```yaml
# scripts/build.yml
description: Build the workspace
command: pnpm build --json
timeout_seconds: 900
result_mode: json
```

`script` and `command` are mutually exclusive. `prompt`, `model`, and `provider`
are load errors on a script step. `inputs` are materialised as files and exposed
as `CLARA_INPUT_<LABEL>`, `CLARA_INPUTS`, `CLARA_ARTIFACTS`, and
`CLARA_REQUEST`. The runner inherits a small base environment plus `passEnv` and
the step's `env`.

`result_mode` is `auto` (default), `json`, `text`, `exit`, or `tail`. In `auto`
mode, valid JSON on stdout becomes the step result; otherwise the result is
`{ exit_code, stdout, stderr }`. In `json` mode, unparseable stdout fails the
step instead of storing a parse error as a result. A nonzero exit fails the step unless it is in
`success_codes`. Script output is capped by `max_output_bytes` (default 64 KiB)
and streamed as `step.output` events. Script retries default to one attempt, so
a side effect is not replayed accidentally.

### Failure recovery

Any agent, script, or router leaf step may declare `on_failure`. The branch runs
after the step exhausts `retries.auto_attempts`:

```yaml
steps:
  - name: verify_health
    type: script
    command: clara rebuild health --json
    result_mode: json
    retries:
      auto_attempts: 2
    on_failure:
      max_cycles: 1 # default 1, cap 3
      retry: true # retry the step after recovery
      steps:
        - name: recover_services
          type: script
          command: clara rebuild recover --json
          result_mode: json
```

- The failed step moves to `recovering` and its recovery children run in
  declaration order at `<step>/on_failure/<n>-<name>`.
- Recovery steps receive the failed attempt as context: agents see a
  `# Failure being recovered` section, scripts get `CLARA_FAILURE` and
  `failure.json`. They cannot reference the failed step through `inputs`.
- `retry: true` returns the step to `ready` with one extra attempt allowed.
  `retry: false` marks it `done` from the recovery result and continues.
- A failed recovery fails the step and the run with both errors. A recovered
  failure emits `step.recovering` and `step.recovered` instead of a failure
  alert; only an exhausted recovery creates an alert.
- `on_failure` is a leaf feature. Nested recovery branches are load errors.
- A success after recovery sets `steps.recovered = 1`; `run.completed` carries
  a `recoveries` summary.

## Runners

The engine never spawns a process. `script` steps are executed by a
runner, which claims work, renews the lease, streams output, and reports the
result. The runner is a role on the same work-order protocol as an agent
adapter.

There are two hosts:

- **Shared standalone (default).** `clara-adapter-opencode install`
  writes `~/.config/clara/runner.json` and installs a user service on Linux or
  macOS. One runner serves every harness in the workspace. Use
  `clara-runner` when a service manager is unavailable.
- **Embedded (fallback).** The OpenCode adapter can still import
  `@clara/runner` inside its own process when `runner.enabled` is not `false`.
  The installer disables it so a shared runner is the only one for the
  workspace. Embedded remains useful for containers without a supervisor and
  for a legacy install that has not been migrated.

Claims are capability-filtered. Agent and router work is additionally scoped to
the harness that owns the run, or to the adapter pinned by
`requires.adapter`. Script work is deliberately shared: any runner with the
`script` capability can claim it in that workspace, so one runner serves every
harness. `POST /v1/runs/:id/next` and `clara_next` accept `capabilities` and
`harness`, and a standalone runner uses `POST /v1/work/next` to claim script
work across the active runs of its workspace without enumerating run ids. A
step that sets `requires.runner: build-host` is only released to a runner with
that id or label. If a ready script step has no capable runner for
`CLARA_RUNNER_WAIT_MS` (default 60 s), the watchdog opens one `no_runner` alert.

The adapter writes `runner.enabled: false` to
`~/.config/opencode/clara-policy.json` when a shared runner is installed, so the
plugin does not start a second runner. The shared runner reads
`~/.config/clara/runner.json`:

```json
{
  "url": "http://127.0.0.1:8789",
  "workspace": "/path/to/project",
  "concurrency": 2,
  "labels": []
}
```

`CLARA_RUNNER_ENABLED`, `CLARA_RUNNER_CONCURRENCY`, `CLARA_RUNNER_LABELS`, and
`CLARA_RUNNER_ID` override the adapter config. A script that restarts its own
host is safe on the shared runner because it does not live inside the harness
process. The maintenance CLI keeps its restart journal, so a retry resumes
instead of repeating a rebuild.

## Step and run invariants

A container is `failed` when any child failed, `done` only when every child
succeeded, and `running` otherwise. Children are inspected even after an earlier
live sibling, so a failure is never hidden behind declaration order. A router
row stays `done` once it records its route; the selected branch carries the
failure.

When a run ends failed or cancelled, every step settles in the same transaction:
the failing step keeps `failed`, interrupted work becomes `cancelled`, and work
that never started becomes `skipped`. Leases are cleared, child runs are
cancelled, and the terminal run state is monotonic. A terminal run therefore
never exposes a `pending`, `ready`, `running`, or `waiting_children` step, and a
late worker call is rejected.

## Attempt history

`steps` is the live projection: one row per step per run. Every claim also
appends an immutable row to `step_attempts` with the attempt number, outcome,
usage, timings, model, result, and error. A retry therefore never overwrites the
previous attempt's data, and the step's counters describe one attempt instead of
mixing the final attempt with the lifetime of the step. The live row resets its
result, error, timings, and usage when a new attempt starts, so it never
presents a previous attempt as the current one. Attempt status is one of
`running`, `waiting_children`, `retry`, `done`, `failed`, or `cancelled`.

Events record the same transitions and carry `attempt_id`, so a `step.started`,
`step.retry`, `step.failed`, `step.completed`, or `step.routed` event joins to
the attempt row that produced it. Events stay a stream: results, usage, and
durations live only in `step_attempts`, so the event log can be truncated
without losing run history. Attempt rows are retained with their run.

Read history with `GET /v1/runs/:id/attempts` or
`GET /v1/runs/:id/steps/:path/attempts`, or the `clara_attempts` MCP tool.

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
    - when: research
      criteria: a request for external research or a cited brief.
      run: std:research
```

The engine renders those entries as a bullet list and substitutes it for
`[ROUTES]` in the router Markdown:

```text
- `software-development` — a normal software feature, bug, or example request.
- `research` — a request for external research or a cited brief.
```

Routers without the placeholder get the list appended under a `## Routes`
heading. `criteria` falls back to the legacy `description` field. The rendered
prompt is part of the pinned run snapshot and the work order.

## Models and providers

The service does not call a model, but every dispatched step carries the model
and provider that owns it so the harness can pin the worker session. Standard
packages do not pin a model. They inherit the workspace defaults, so a fresh
install runs against whatever provider the user's OpenCode can reach.

```yaml
# custom index.yml named by CLARA_ENGINE_CONFIG
defaults:
  provider: opencode-go
  model: deepseek-v4.1-flash

overrides:
  std:research:
    defaults:
      provider: openai
      model: gpt-5
    pipelines:
      research:
        default_model: gpt-5
    agents:
      draft_report:
        model: gpt-5
```

The workspace `defaults` apply to the root package and every imported package.
An imported package can still declare its own defaults. Resolution runs from
the most specific value to the least:

1. step `model` / `provider`
2. pipeline `default_model` / `default_provider`
3. agent frontmatter `model` / `provider`
4. package manifest `defaults.model` / `defaults.provider`
5. workspace `defaults`

A step may override only one half; the other is inherited independently.

`overrides` replaces only the keys it names for an imported package, keyed by
its import ref (`std:software`). It accepts `defaults` (`model` / `provider`),
`pipelines.<id>` (`default_model` / `default_provider`), and `agents.<name>`
(`model` / `provider`). Unknown packages, pipelines, agents, and keys fail at
load time. Standard packages never need editing: the override is applied before
compilation, so the lab preview, pinned snapshot, and hash all reflect the
effective values.

A package or step with no model or provider falls back to the harness default,
which the lab flags with `model_unset`. The OpenCode adapter creates each
managed worker session with the work order's `{ providerID, id }` and a primary
worker agent, then verifies the persisted agent, model, and workspace before
prompting it. The worker agent defaults to `build` and can be overridden with
`CLARA_WORKER_AGENT`; a subagent-only or missing override falls back to `build`
because managed workers run in top-level sessions.

## Inputs and artifacts

A step declares the earlier results it uses instead of receiving every result in
the run:

```yaml
steps:
  - name: create_spec
    type: agent
  - name: code_review
    type: agent
    inputs:
      spec: create_spec
      tests: write_tests
    artifacts:
      spec: spec.md
      docs: docs/README.md
```

`inputs` maps a label to an earlier sibling step; `artifacts` maps a label to a
workspace-relative path or glob. Both accept a list for the common case where
the label and the target are the same (`inputs: [create_spec]`,
`artifacts: [spec.md]`).

- The compiler resolves every input label to the compiled step path, so the
  pinned snapshot and run hash cover the wiring.
- Inputs must point to an earlier sibling in the same pipeline or group.
  Unknown, forward, self, and `background: true` references fail at compile
  time with the available names.
- A declared input is rendered in full to an agent. An agent sees `# Inputs` in
  its prompt. A script receives the same results as JSON files in
  `CLARA_INPUT_<LABEL>` with an index at `CLARA_INPUTS`. Nothing else is
  pushed: an undeclared result does not appear in the work order and cannot be
  read by the executor. A step with no `inputs` receives no earlier result, only
  its artifacts and the request reference.
- Artifacts are paths, not contents. An agent reads them with its own tools; a
  script reads them from the workspace or `CLARA_ARTIFACTS`. The preview flags a
  literal path that does not exist.
- A step waits until its declared inputs have results. If one can never produce
  a result, the step fails with `input_unavailable` instead of starting without
  it.

## Worker prompt

The adapter turns an `agent` or `router` work order into one model prompt. A
script work order has no prompt; the runner executes `script.command` directly.

1. the pinned step prompt from the package; a router prompt already contains the
   rendered route list, so the adapter never appends it again,
2. the declared input results from `context.inputs`, in full, under `# Inputs`,
3. the artifact paths from `context.artifacts` under `# Artifacts`,
4. the previous attempt's error and partial result on a retry, under
   `# Previous attempt`,
5. the root request from `context.prompt` under `# Reference: original request`,
   with a precedence note that the step instruction is authoritative and the
   request is background scope; `request: false` omits it,
6. one finish instruction for the step kind.

A router is the exception: the request is its primary input, so it follows the
router instructions as `# Request` without the background note.

The prompt does not repeat the run id, step path, work token, model, enforcement,
attempt, or budget. Those are engine state. The adapter binds the run id,
step path, and work token to the managed session and supplies them to the control
tools, so a worker only sends the route key, the result, or the failure reason.

The worker is expected to finish through a Clara control tool. If a managed agent
session goes idle without one, the adapter sends a single corrective turn. If it
still does not call a control tool, the adapter records the final assistant text
as an inferred completion (`{ summary, inferred: true }`) instead of discarding
correct work. Routers never infer a decision: a missing route key fails the
step.

A control call settles the binding before it returns. The adapter does not
interrupt a worker that already recorded its step: the closed binding stays for
the rest of the turn, so later tool calls are still denied, and the idle watcher
releases it without sending a corrective turn. A fallback binding of the human's
session detaches at once and is never interrupted.

The adapter also scopes the tool list for each model call. A router sees only
`clara_route` and `clara_fail`; an agent keeps its repository tools and sees only
`clara_complete`, `clara_fail`, and `clara_spawn` from the Clara namespace. The
route parameter is an enum of the work order's route keys, so routing is a
structured choice instead of a free string. The engine still validates the
key and rejects an unknown route.

Clara control tools are registered as native tools, not Code Mode-only tools.
If the harness still has Code Mode enabled, the adapter preserves the `execute`
and `search` gateway instead of deleting it. A Code Mode session can therefore
keep using scripts for repository work while calling `clara_route`,
`clara_complete`, and `clara_fail` directly. Removing the gateway would make the
model emit the call as plain text because the harness had told it to use
`execute`.

Tool scoping applies only to sessions the adapter created. If dispatch falls
back to the parent session, that session keeps the human-facing agent's tools.

## Standard software pipelines

The `std:software` package routes feature, bug, and documentation requests to
three strict lifecycles. Feature work runs spec, plan, tests, build, an
independent verification gate, review, and docs. Bug work runs reproduction, a
failing regression test, the smallest fix, verification, review, and docs.
Documentation-only work runs assessment, in-place updates, link and index
verification, and review. Every agent step resolves to a Markdown agent under
`packages/orchestration/engine/std/software/agents`; the loader test fails when a
pipeline names a missing agent. Bug agents opt into `on_exhausted: fail`, carry a token `growth_rate` so a
retry has more room than the attempt it replaces, and limit automated attempts
(one retry for most steps, two for the fix) so a failing lifecycle stops with
an alert instead of spending a larger budget on the same investigation.

```text
feature: create_spec → plan_implementation → write_tests → build_feature →
         verify_implementation → code_review → update_docs
bug:     identify_bug → write_regression_test → fix_bug → verify_bug_fix →
         code_review → update_docs
docs:    assess_docs → update_docs → verify_docs → docs_review
```

## Diagnostics pipeline

The `std:diagnostics` package audits the engine itself. Its `diagnose`
pipeline collects a deterministic report from run history, patterns the
failures, audits the package and watchdog setup, ranks issues, proposes fixes,
and returns the reviewed Markdown report. It uses `observed` enforcement so a
missing or stale adapter does not block the diagnosis. Evidence collection is a
script; the interpretation agents never edit files or mutate the database. Run it from Clara with a request such as "audit
the engine setup"; the configured router selects it. In the Lab, an
operator can start it directly with `target: std:diagnostics`. See
[diagnostics.md](diagnostics.md).

## Maintenance pipeline

The `std:maintenance` package has three pipelines. `rebuild` snapshots the
running services and adapters, runs `pnpm install --frozen-lockfile` and
`pnpm build`, installs the configured harness adapters, restarts only the services that
were running, and verifies every health endpoint. `recover` restores services
from the current snapshot without rebuilding or recapturing. `diagnose` collects
a failed run and the snapshot, classifies the failure with two read-only agents,
and returns safe next actions. The deterministic mechanics live in
`clara rebuild status|build|adapters|restart|health|inspect|recover` and
`clara-engine inspect`; the rebuild and recover steps are scripts,
so no model turn is involved. The engine restarts last, the command waits
for `/health` before the worker reports completion, and a restart journal makes
a retry resume instead of repeating the rebuild. Restart and health retry once
and then run a bounded `on_failure` branch that restarts only the expected
services that are not answering. An engine reached through a non-loopback
URL is treated as external and verified but not restarted unless the operator
passes `--manage-external`. All three pipelines use `observed` enforcement so
they can run while the adapter or setup is degraded. See
[maintenance.md](maintenance.md).

## Edge cases

- A strict run starts with no adapter: it is refused with
  `enforcement_unavailable`, never downgraded silently.
- A router selects an unknown route: the step is rejected and the run fails.
- A worker answers in text without calling a Clara control tool: an agent gets one
  corrective turn, then completes from its final text with `inferred: true`; a
  router still fails with `missing control call`.
- A worker disappears: its lease expires, the watchdog marks it retried or
  failed, and the alert reaches the origin session. A failure settles the run
  and every ancestor step in the same transition.
- A background child fails: the group fails fast even when an earlier sibling is
  still live, live steps are cancelled, and the group's retry or escalation
  policy applies.
- A worker finishes after its run already failed: the call is rejected with
  `run_terminal` instead of recording work under a terminal run.
- A spawned batch succeeds: the parent step records the child results and the
  pipeline continues without a second model turn.
- A script exits nonzero: the step fails with the exit code and output tail
  unless the code is in `success_codes`. Scripts default to one attempt.
- A step with `on_failure` exhausts its retries: the recovery branch runs. A
  successful recovery retries the step once or completes it from the recovery
  result; a failed recovery fails the step and the run with both errors.
- A recovered failure succeeds: it emits `step.recovered` and appears in the
  `run.completed` `recoveries` summary, but it does not create a failure alert.
- A recovery branch is still running when the run is cancelled: the failed step
  and its recovery children are cancelled with the rest of the run.
- A script exceeds `timeout_seconds`: the runner terminates the process group
  and fails the step. The attempt records the timeout, not a model stall.
- A ready script step has no runner: it stays ready and the watchdog opens one
  `no_runner` alert after `CLARA_RUNNER_WAIT_MS`. Start the shared runner
  service or `clara-runner`; the step is not failed.
- A strict pipeline mixes agents and scripts: the harness adapter and the runner
  are checked separately, and both must be live.
- A script writes more than `max_output_bytes`: the result keeps a truncated
  tail and the streamed `step.output` events stay bounded.
- A script restarts its own host: a shared runner is unaffected. If the
  workspace still uses the embedded fallback, run that step with
  `clara-runner` on the service host or rely on the command's journal on
  the next attempt.
- The origin session is archived, missing, or no longer uses the Clara agent:
  the result stays in the inbox and the adapter does not prompt that session.
- The package tree changes mid-run: the pinned snapshot still applies.
- The service restarts with ready work: the outbox and step state restore the
  next work order; no watchdog tick is required to advance healthy work.
- The adapter restarts with active runs: it adopts non-terminal runs for its
  workspace, so dispatch and delivery resume without a new user request.
- A worker exceeds its turn/tool/token budget: budgets are hard caps in every
  enforcement mode, including `observed`. Policy checks deny further work tools
  and record one `budget.exhausted` event per attempt, but the Clara control
  tools (`clara_route`, `clara_complete`, `clara_fail`, `clara_spawn`) stay
  available so the worker can still finish or report the failure. The token
  budget reserves its last 8% (capped at 10k tokens) for the final report, so
  work tools are denied before the hard limit and the worker keeps enough room
  to answer. The reserve shares the attempt's single `budget.exhausted` event.
  A completion that arrives over budget is kept and marked `over_budget` on its
  `step.completed` event instead of being retried; the result is never
  discarded. A step that sets `limits.on_exhausted: fail` opts out: when a
  budget denial cut the worker short, the attempt is retried instead of
  advancing, and the partial result is carried into the next attempt as a
  `# Previous attempt` handoff. The last attempt fails the step and the run.
  The OpenCode adapter reports model token usage from
  assistant-message events, so token budgets are enforced for managed workers
  too. It also reports a cache-weighted `budgetTokens` total (cache reads and
  writes count at 10%, because a long session re-reads its context every turn)
  and enforcement prefers it; step rows and cost displays keep the raw count.
  A harness that only reports `tokens` keeps the raw behavior. The adapter
  caps each managed tool result at 48k characters with a truncation marker, so
  one large read or grep cannot consume a step's whole budget; the human's
  session is never capped.
- A step is `observed`: permission denials are recorded as `policy.observed`
  events, but tools are not blocked. `strict` and `sandboxed` steps deny and
  count violations. Enforcement mode does not relax the resource budgets above.
- A custom config file is missing: start fails with a clear config error
  instead of guessing a pipeline. Without a custom config, the bundled default
  is used.
- A step declares a model without a provider: the lab reports
  `model_provider_missing`; the adapter refuses to silently pin a provider and
  logs an incomplete model reference instead.
- A model or provider does not exist in the running OpenCode catalog: the lab
  reports `model_unknown` (and `model_disabled` for disabled models) before the
  run starts.

## Out of scope

- The engine calling a model, creating a session, or spawning a process.
  Runners execute scripts; the service only owns state.
- MCP-only strict enforcement without a harness adapter or sandbox.
- A visual pipeline editor; YAML and Markdown are the authoring surface.
- Remote access to the engine; it binds loopback only.
- More than one PSK or token model for the engine.

## Known gaps

- The OpenCode adapter is the first strict adapter. Other harnesses can use the
  generic MCP surface in observed mode or implement the adapter protocol. The
  script runner is shared in `@clara/runner`; a new adapter imports it rather
  than reimplementing execution.
- A standalone runner is a separate process. It is not supervised by the
  engine; use the service manager or container of your choice.
- Script execution is POSIX-first. The Windows path uses `cmd /d /s /c` and
  `taskkill`, but the standard packages target the host that runs the CLI.
- A script that needs dynamic request arguments must read `CLARA_REQUEST` in a
  wrapper command. The runner does not interpolate request text into the
  command.
- Token limits depend on harness-reported usage. The OpenCode adapter reports
  model token usage from assistant-message events; another harness must report
  it through `clara_usage`. Turn, tool-call, wall-clock, and attempt limits are
  exact.
- There is no needs-input tool yet. A worker can fail, but it cannot pause and
  ask the human a question mid-step.
- Delivery targets the Clara agent (`CLARA_INTERFACE_AGENT`, default `clara`).
  A run started from another agent leaves its alerts in the inbox.
- Multiple OpenCode adapters registered for the same workspace would both adopt
  active runs. Run one adapter per workspace.
- The generic MCP bridge cannot see the harness session ID. Pass
  `origin.session_id` or use an adapter to bind the root session.
- The web Settings page does not show the package catalog yet; it is available
  through Clara Lab, `clara status lab --check`, and MCP `clara_catalog`.
- The OpenCode adapter dispatches managed workers in the run workspace with a
  primary worker agent (`CLARA_WORKER_AGENT`, default `build`), not the caller's
  agent. Subagent-only overrides fall back to `build` because managed workers run
  in top-level sessions.
- Clara Lab compiles the files on the host. A containerized service with a
  different workspace mount can produce a different preview than the run.

## Technical appendix

<details>
<summary>Commands, packages, data, and references</summary>

- Service: `apps/engine`, loopback REST, SSE, and `/mcp`.
- MCP: `packages/orchestration/mcp` provides the shared tools and the stdio bridge,
  which talks to the service over loopback HTTP.
- Engine: `packages/orchestration/engine`; policy: `packages/orchestration/policy`;
  script runner: `packages/adapters/runner`; adapter installer:
  `apps/adapters/opencode`; harness-neutral adapter runtime: `packages/adapters/runtime`;
  orchestration binding core: `packages/adapters/binding`; developer preview and probe:
  `packages/preview` and `tools/lab`.
- Standard packages: `packages/orchestration/engine/std/software`,
  `packages/orchestration/engine/std/content`, `packages/orchestration/engine/std/research`,
  `packages/orchestration/engine/std/diagnostics`, and
  `packages/orchestration/engine/std/maintenance`. The research pipeline scopes the
  question, gathers external sources, verifies every material claim against
  independent dated sources, and returns a concise linked Markdown report. The
  diagnostics pipeline analyzes the engine database and setup, then
  returns ranked issues with proposed fixes. The maintenance pipeline is
  entirely deterministic scripts that rebuild Clara, reinstall its adapters,
  restart the captured services, and verify health. See
  [maintenance.md](maintenance.md).
- Primary config: `packages/orchestration/engine/default/index.yml`, bundled with the
  engine. Set `CLARA_ENGINE_CONFIG` to a custom `index.yml` to replace
  it. The default imports the five standard packages and routes to them.
- Data: local installs use
  `${CLARA_DATA_DIR:-~/.local/share/clara}/orchestration.db`,
  `engine.token`, and `policy-delivery.json` (adapter delivery cursor).
  The Docker stack keeps them in the `clara-orchestrator-data` volume.
- Workspace: `GET /v1/config` reports the service workspace from
  `CLARA_ENGINE_WORKSPACE` (default: the service's working directory),
  the active `configSource` (`bundled` or `file`), and `configPath` when a
  custom file is configured.
- Container: `docker compose -f infra/docker/engine.compose.yml up -d --build engine`;
  the hub uses `infra/docker/server.compose.yml` on the same `clara` network.
- Commands:
  `clara start|stop|restart|status|logs engine`,
  `clara adapter install|upgrade|verify|remove <kind> [--mcp]`,
  `clara adapter start|stop|status|logs <kind>`,
  `clara start runner [--workspace <path>] [--label <name>]`,
  `clara rebuild status|build|adapters|restart|health`,
  `clara start lab`, `clara status lab --check`.
  `clara-engine` remains the standalone engine binary.
- Diagnostics: `clara-engine analyze [--json] [--days n] [--db
path] [--url url]` and `GET /v1/diagnostics?days=30`. The analyzer is
  `packages/orchestration/engine/src/diagnostics.ts`; see
  [diagnostics.md](diagnostics.md).
- OpenCode entry point: the `clara` agent at
  `~/.config/opencode/agents/clara.md`, installed by the adapter. The MCP-only
  path keeps a manual `/pipeline` command at
  `~/.config/opencode/commands/pipeline.md`.
- Adapter delivery: non-terminal runs are adopted at startup. New alerts and
  finished root runs are queued into origins whose agent is
  `CLARA_INTERFACE_AGENT` (default `clara`). `POST /v1/runs/:id/delivery/claim`
  atomically reserves the terminal run and named alerts, and
  `POST /v1/runs/:id/delivery/release` returns them when the prompt fails.
  The local cursor in `policy-delivery.json` avoids unnecessary claims; a
  missing file is treated as a fresh install, so historical terminal runs are
  not replayed. Claims persist in the engine database, so adapter
  restarts and multiple plugin instances cannot re-send a finished run.
- MCP tools: `clara_start`, `clara_next`, `clara_complete`, `clara_fail`,
  `clara_route`, `clara_spawn`, `clara_status`, `clara_attempts`, `clara_inbox`,
  `clara_cancel`, `clara_tick`, `clara_check`, `clara_usage`, `clara_heartbeat`,
  `clara_catalog`, and the adapter administration tools. `clara_next` accepts
  `capabilities`; `clara_complete` and `clara_fail` accept `exit_code`.
- Package assets: `pipelines/*.yml`, `routers/*.md`, `agents/*.md`, and
  `scripts/*.yml`; `index.yml` declares the entry, imports, defaults, overrides,
  and inline pipelines. See [orchestration-dsl.md](orchestration-dsl.md) for
  every manifest, pipeline, step, agent, router, and script field.
- References: `std:software` (package entry), `std:software/feature`,
  `std:software/bug`, and `std:software/docs` (named pipelines), `std:research`
  (research brief), `std:diagnostics` (self-diagnosis), `std:maintenance`
  (rebuild), `std:maintenance/recover`, `std:maintenance/diagnose`, bare names
  (same package). These are for the Lab and operator tooling; model-facing
  `clara_start` always uses the configured entry. An import may set `select` to
  load only named pipelines; if it removes the package entry, the first selected
  pipeline becomes the entry.
- Run responses: `GET /v1/runs`, `GET /v1/runs/:id`, and all MCP run payloads
  return summaries without `snapshot`, and status steps omit prompts, policy,
  limits, and lease tokens while keeping results. `GET /v1/runs/:id/snapshot` returns
  `{ run_id, hash, snapshot }`; `GET /v1/runs/:id/steps/:path` returns the full
  step row. `GET /v1/runs/:id/attempts` and
  `GET /v1/runs/:id/steps/:path/attempts` return attempts, and `clara_attempts`
  exposes the same history over MCP. `POST /v1/runs/:id/delivery/claim` and
  `POST /v1/runs/:id/delivery/release` reserve or return a terminal run and its
  named alerts for the origin-session adapter. These endpoints are
  bearer-protected and exist for the Lab and analysis.
- SSE: `GET /v1/events?since=<event-id>` publishes run, step, policy, and alert
  events for bridge notifications and direct harness subscriptions. Step events
  carry `attempt_id` so subscribers can join them to `step_attempts`.
- See [capabilities.md](capabilities.md) for shipped scope.

</details>
