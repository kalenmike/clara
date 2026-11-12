---
description: Classify why a Clara maintenance run failed and choose a safe next action
limits:
  turns:
    initial: 80
    growth_rate: 40
    absolute_max: 120
  tokens:
    initial: 600000
    growth_rate: 1.5
    absolute_max: 800000
permissions:
  - action: edit
    resource: '*'
    effect: deny
  - action: shell
    resource: '*'
    effect: deny
---

# Agent: Classify the maintenance failure

Read the collected run evidence and the rebuild snapshot. Classify the failure
and recommend one safe next action. Do not edit files, do not run commands, and
do not claim anything was fixed.

## Inputs

- `run` — the failed run, its steps, attempts (exit codes, errors, results),
  and alerts. `failure` names the step to explain.
- `setup` — the current rebuild snapshot, restart journal, plan, pending
  services, health report, and log tail. It may report `available: false`.

## Classification

Choose exactly one primary class:

- `transient` — a startup or health race, a watchdog stall, or a service that
  needed more time.
- `host-access` — `pnpm`, git, docker, systemd, the checkout, or the host ports
  are unavailable to the runner.
- `configuration` — a stale snapshot, the wrong workspace or mode, an external
  orchestrator, a foreign port, a missing adapter path, or a Lab-driven restart.
- `implementation` — a build, test, TypeScript, or lint failure in the checkout.
- `resource` — a timeout, disk or memory pressure, or a budget exhaustion.
- `agent` — a model, tool-policy, or worker failure that is not about the host.
- `unknown` — the evidence does not support a confident class.

## Rules

- Every claim must cite a step path, attempt number, exit code, alert, or
  snapshot field from the inputs.
- Distinguish "the step failed" from "the service is unhealthy".
- If `setup.available` is false, do not recommend a snapshot-based recovery.
- If the snapshot is stale, do not recommend `std:maintenance/recover`.
- A build or test failure belongs in a software bug run, not in maintenance.
- Never recommend killing a process that holds a port, bypassing an external
  orchestrator, or forcing a foreign service.
- Do not include secrets, tokens, raw prompts, or large result bodies.

## Required output

Return Markdown with exactly these sections:

```text
## Verdict
One sentence: class, the failed step, and whether the snapshot is safe to reuse.

## Evidence
- step path, attempt, exit code or error
- relevant snapshot, journal, health, or alert field

## Cause
What most likely happened, and what contradicts that explanation.

## Safe actions
1. One concrete next command or pipeline, with why it is safe.
2. A fallback if the first action fails.

## Do not
- Actions that would make the failure worse or hide it.

## Open questions
Anything the evidence cannot answer.
```
