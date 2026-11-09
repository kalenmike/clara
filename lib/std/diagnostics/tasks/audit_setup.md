---
description: Audit pipeline configuration, limits, routing, and adapter setup against the evidence
limits:
  turns:
    initial: 36
    growth_rate: 4
    absolute_max: 48
  tokens:
    initial: 80000
    growth_rate: 1.5
    absolute_max: 160000
permissions:
  - action: edit
    resource: '*'
    effect: deny
  - action: shell
    resource: '*'
    effect: deny
---

# Task: Audit the setup

Read the orchestration configuration and compare it with the evidence. Use the
repository read and grep tools; do not edit files and do not run the pipelines.

Start with:

- `orchestration/index.yml` for imports, defaults, package overrides, watchdog
  thresholds, the escalation pipeline, and router criteria,
- each `lib/std/*/index.yml` for defaults, enforcement, and entry points,
- `lib/std/*/pipelines/*.yml` for steps, retries, limits, and enforcement,
- `lib/std/*/routers/*.md` for route criteria, turn and token budgets,
- `lib/std/*/tasks/*.md` for prompts, permissions, and limits.

## Checks

1. **Budgets**: do the turn, token, tool-call, or violation limits in the
   evidence line up with the configured limits? A router that repeatedly reaches
   its turn limit is a setup bug, not a worker bug.
2. **Stalls and leases**: does the watchdog `stalled_threshold_seconds` make
   sense for the observed step durations and model latency? Are leases long
   enough for the work each task describes?
3. **Routing**: are route criteria mutually exclusive and unambiguous? Does each
   route target resolve to a real package or pipeline? Is the escalation
   pipeline present and safe from loops?
4. **Prompts and tasks**: does every step resolve to a real task document, or
   does it fall back to a generated description-only prompt? Are instructions
   specific enough to finish within the budget?
5. **Models and providers**: does every task and router declare or inherit both
   a model and a provider? Do the defaults match the models the harness actually
   serves?
6. **Enforcement and adapters**: are strict pipelines used where the adapter is
   live and heartbeating? Is a pipeline strict when it must run on a broken
   setup?
7. **Permissions**: are shell, edit, and network permissions narrow enough for
   the task, but not so narrow that the worker has to work around them?
8. **Duplication**: are there duplicate alert sources, repeated watchdog
   retries, or a configuration value that explains the `terminal_event_storm`
   or `duplicate_alerts` anomaly?

## Required output

Return `SETUP-n` findings only. Each must name the file and field, the matching
evidence, and why it matters. Mark anything you could not verify as `unknown`.
Return at most 10 findings. Do not propose fixes yet.
