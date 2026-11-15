---
description: Audit pipeline configuration, limits, routing, and adapter setup against the evidence
limits:
  turns:
    initial: 100
    growth_rate: 50
    absolute_max: 150
  tokens:
    initial: 1500000
    growth_rate: 1.5
    absolute_max: 2000000
permissions:
  - action: edit
    resource: '*'
    effect: deny
  - action: shell
    resource: '*'
    effect: deny
---

# Agent: Audit the setup

Read the orchestration configuration and compare it with the evidence. Use the
repository read and grep tools; do not edit files and do not run the pipelines.

Start with:

- the active orchestration config: the bundled default, or the file named by
  `CLARA_ENGINE_CONFIG`, for imports, defaults, package overrides, router
  criteria, and reserved watchdog settings,
- the standard packages bundled with the orchestrator engine (under
  `packages/orchestration/engine/std` in the Clara checkout) for defaults, enforcement,
  and entry points,
- their `pipelines/*.yml` for steps, retries, limits, and enforcement,
- their `routers/*.md` for route criteria, turn and token budgets,
- their `agents/*.md` for prompts, permissions, and limits,
- their `scripts/*.yml` for deterministic script commands, timeouts, and input
  handling.

## Checks

1. **Budgets**: do the turn, token, tool-call, or violation limits in the
   evidence line up with the configured limits? A router that repeatedly reaches
   its turn limit is a setup bug, not a worker bug.
2. **Stalls and leases**: do `CLARA_ENGINE_STALLED_MS`, the lease
   duration, and `CLARA_RUNNER_WAIT_MS` make sense for the observed step
   durations and model latency? The `watchdog` block in the config is reserved
   until the orchestrator wiring lands; do not treat it as active.
3. **Routing**: are route criteria mutually exclusive and unambiguous? Does each
   route target resolve to a real package or pipeline? Is the escalation
   pipeline present and safe from loops?
4. **Prompts and agents**: does every step resolve to a real agent or script document, or
   does it fall back to a generated description-only prompt? Are instructions
   specific enough to finish within the budget?
5. **Models and providers**: does every agent and router declare or inherit both
   a model and a provider? Do the defaults match the models the harness actually
   serves? Script steps must not declare a model at all.
6. **Enforcement and adapters**: are strict pipelines used where the adapter is
   live and heartbeating? Is a pipeline strict when it must run on a broken
   setup?
7. **Permissions**: are shell, edit, and network permissions narrow enough for
   the agent, but not so narrow that the worker has to work around them?
8. **Duplication**: are there duplicate alert sources, repeated watchdog
   retries, or a configuration value that explains the `terminal_event_storm`
   or `duplicate_alerts` anomaly?

## Required output

Return `SETUP-n` findings only. Each must name the file and field, the matching
evidence, and why it matters. Mark anything you could not verify as `unknown`.
Return at most 10 findings. Do not propose fixes yet.
