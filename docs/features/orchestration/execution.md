---
title: Run execution
---

# Run execution

## Summary

A run is one compiled pipeline executed step by step. The engine pins the
snapshot, hands out work orders, and advances state; an adapter runs agent and
router steps and a runner runs scripts.

## User flow

1. `clara_start` compiles the config, pins the snapshot, and creates the run.
2. The adapter claims the first order and records the caller as run origin.
3. A managed worker gets one prompt and finishes through a control tool.
4. A runner claims script steps and reports output and result.
5. A terminal run is delivered to the origin session as a synthetic prompt.

## Core business rules

1. **State is event-driven.** A completion, failure, route, or spawn advances
   the run in one transaction; the watchdog repairs leases, silent workers,
   restart gaps, and deadlines the same way.
2. **Leases own work.** Renewal, completion, failure, routing, and spawn need
   the work token, so an abandoned attempt cannot keep a retried step alive.
3. **Budgets are hard caps** in every enforcement mode; control tools stay
   available after a denial.
4. **A terminal run is final.** Late calls fail with `run_terminal`.

## Step types

| Type       | Executor        | Input                      | Output                |
| ---------- | --------------- | -------------------------- | --------------------- |
| `agent`    | harness adapter | rendered prompt, inputs    | text or JSON result   |
| `router`   | harness adapter | router prompt, request     | one route key         |
| `script`   | runner          | command, inputs            | stdout, exit, or JSON |
| `pipeline` | engine          | referenced/inline children | child results         |
| `group`    | engine          | inline children            | child results         |

Field definitions live in [packages.md](packages.md).

## Runners

The engine never spawns a process. A runner claims a script step, renews the
lease, streams `step.output`, and reports the result. One shared standalone
runner (`clara start runner`) serves the workspace; the OpenCode adapter's
embedded runner is a fallback when `runner.enabled` is not `false`.

Claims are capability-filtered: agent and router work is scoped to the owning
harness or `requires.adapter`, while script work is shared by any runner with
the `script` capability. With no capable runner the step stays ready, and one
`no_runner` alert opens after `CLARA_RUNNER_WAIT_MS` (60 s).

## Leases and heartbeats

A claim returns a work token and a lease. The adapter renews every ten seconds
while a step runs; the model never heartbeats itself, so a long turn does not
look like a stall.

The watchdog runs every ten seconds. A step whose heartbeat is older than
`CLARA_ENGINE_STALLED_MS` (five minutes) or whose lease expired is requeued
while attempts remain, or failed with a `stalled` alert. A managed worker that
loses its lease is stopped; a fallback binding of the parent session detaches.

## Invariants and attempts

A container is `failed` when any child failed, `done` only when every child
succeeded, and `running` otherwise; children are inspected even after a live
sibling, so a failure is never hidden. A router row stays `done` once it records
its route, and the selected branch carries the failure.

When a run ends failed or cancelled, every step settles in one transaction: the
failing step keeps `failed`, interrupted work becomes `cancelled`, unstarted work
becomes `skipped`, and no `pending`, `ready`, `running`, or `waiting_children`
step survives.

`steps` is the live projection; every claim also appends an immutable
`step_attempts` row with outcome, usage, timings, model, result, and error, so a
retry never overwrites the previous attempt. Status is `running`,
`waiting_children`, `retry`, `done`, `failed`, or `cancelled`, and events carry
`attempt_id`. Read history from `GET /v1/runs/:id/attempts` or
`clara_attempts`.

## Dispatch

Route entries carry the `criteria` that tell the classifier when to pick them.
The engine renders a bullet list, substitutes it for `[ROUTES]`, and appends it
under `## Routes` when the placeholder is absent; the rendered prompt is pinned.
A router returns one `when` key, exposed to the adapter as an enum.

The engine does not call a model, but every dispatched step carries the model
and provider that own it so the harness can pin the worker session. Standard
packages inherit workspace defaults; precedence is defined in
[packages.md](packages.md). The OpenCode adapter creates its managed worker with
the order's `{ providerID, id }` and a primary agent, then verifies agent, model,
and workspace before prompting; the worker agent defaults to `build`.

## Inputs, artifacts, and the worker prompt

A step declares the earlier results it uses; nothing else is pushed. A declared
input is rendered in full to an agent under `# Inputs`, while a script gets a
JSON file in `CLARA_INPUT_<LABEL>` indexed at `CLARA_INPUTS`. Artifacts are
workspace paths, not contents. A step waits for its inputs and fails with
`input_unavailable` if one can never produce a result.

The adapter composes one prompt: the pinned step prompt, declared input results,
artifact paths, the previous attempt's error and partial result, the root request
under `# Reference: original request` unless `request: false`, and one finish
instruction. A router's request is its primary input under `# Request`. The
prompt repeats no run id, step path, work token, model, enforcement, attempt, or
budget; the adapter binds those to the session.

A worker is expected to finish through a control tool. If a managed agent session
goes idle without one, the adapter sends one corrective turn, then records the
final text as an inferred completion (`{ summary, inferred: true }`). Routers
never infer. A control call closes the binding and later tool calls are denied.
A router sees only `clara_route` and `clara_fail`; an agent sees
`clara_complete`, `clara_fail`, and `clara_spawn`.

## Edge cases

- A strict run starts with no capable adapter: refused with
  `enforcement_unavailable`, never downgraded.
- A router picks an unknown route: the step is rejected and the run fails.
- A worker answers in text: an agent gets one corrective turn, then completes
  as inferred; a router fails with `missing control call`.
- A worker disappears: the lease expires and the watchdog retries or fails it.
- A worker calls after its run failed: the call is rejected with
  `run_terminal`.

## Out of scope

- The engine calling a model, creating a session, or spawning a process.
- MCP-only strict enforcement without an adapter or sandbox.

## Known gaps

- Token limits depend on harness-reported usage; the other limits are exact.

## Technical appendix

<details>
<summary>Endpoints, tools, and data</summary>

- Work: `POST /v1/runs/:id/next`, `POST /v1/work/next`, and `clara_next`.
- Delivery: `POST /v1/runs/:id/delivery/claim` and `…/release`.

</details>
