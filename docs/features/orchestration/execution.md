---
title: Run execution
---

# Run execution

## Summary

A run is one compiled pipeline executed step by step. The engine pins the
snapshot and advances state; an adapter runs agent/router steps and a runner runs scripts.

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
lease, streams `step.output`, and reports the result. It belongs on the machine
that owns the workspace, not the hub host: a panel install enables the OpenCode
embedded runner by default (`runner.enabled: false` or `--no-runner` turns it
off); a shared `clara start runner` is optional and both read `engine.json`.

Claims are capability-filtered: agent work stays with its harness, while any
runner with `script` can claim script work for the workspace it registered,
including the run's origin adapter workspace. With no capable runner the step
stays ready and one `no_runner` alert opens after `CLARA_RUNNER_WAIT_MS`.

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
sibling. A router row stays `done` once it records its route.

When a run ends failed or cancelled, every step settles in one transaction: the
failing step keeps `failed`, interrupted work becomes `cancelled`, unstarted work
becomes `skipped`, and no `pending`, `ready`, `running`, or `waiting_children`
step survives.

`steps` is the live projection; each claim also appends an immutable
`step_attempts` row with outcome, usage, timings, model, result, and error, so a
retry never overwrites the previous attempt. Read history from
`GET /v1/runs/:id/attempts` or `clara_attempts`.

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

The engine workspace owns config and run state; the origin adapter workspace
owns workers and scripts. `clara_start` records it, work orders carry it,
wrapper scopes override it, and an adapter falls back to its own workspace when
the engine path is not mounted locally.

A managed dispatch failure is a step failure with `retry: false` and an alert,
never a heartbeat-only worker or an order handed back to the interface agent.

## Inputs, artifacts, and the worker prompt

A step declares the earlier results it uses; nothing else is pushed. A declared
input is rendered in full to an agent under `# Inputs`, while a script gets a
JSON file in `CLARA_INPUT_<LABEL>` indexed at `CLARA_INPUTS`. Artifacts are
workspace paths, not contents. A step waits for its inputs and fails with
`input_unavailable` if one can never produce a result.

The adapter composes one prompt: the pinned step prompt, declared input results,
artifact paths, the previous attempt's error and partial result, the root request
under `# Reference: original request` unless `request: false`, and one finish
instruction. A router's request is its primary input under `# Request`; the
prompt repeats no run id, path, token, model, enforcement, attempt, or budget.

A worker finishes through a control tool. An idle managed session gets one
corrective turn, then its final text is recorded as an inferred completion;
routers never infer. A router sees `clara_route` and `clara_fail`; an agent
also sees `clara_complete`, `clara_fail`, and `clara_spawn`.

## Edge cases

- A strict run starts with no capable adapter: refused with
  `enforcement_unavailable`, never downgraded.
- A router picks an unknown route: the step is rejected and the run fails.
- A worker answers in text: an agent gets one corrective turn, then completes
  as inferred; a router fails with `missing control call`.
- A worker disappears: the lease expires and the watchdog retries or fails it.
- A worker calls after its run failed: the call is rejected with `run_terminal`.
- A wrapper scope fails on an invalid workspace; failures leave the worktree,
  and `clara_spawn` is refused. See [wrappers.md](wrappers.md).

## Out of scope

- The engine calling a model, creating a session, or spawning a process; MCP-only strict enforcement without an adapter or sandbox.

## Known gaps

- Token limits depend on reported usage; the other limits are exact.

## Technical appendix

<details>
<summary>Endpoints, tools, and data</summary>
- Work: `POST /v1/runs/:id/next`, `POST /v1/work/next`, and `clara_next`.
- Delivery: `POST /v1/runs/:id/delivery/claim` and `…/release`.
</details>
