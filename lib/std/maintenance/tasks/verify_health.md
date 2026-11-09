---
description: Verify every captured service and adapter with health checks
limits:
  turns:
    initial: 4
    growth_rate: 2
    absolute_max: 8
  tokens:
    initial: 20000
    growth_rate: 1.5
    absolute_max: 40000
  wall_clock_seconds: 300
permissions:
  - action: edit
    resource: '*'
    effect: deny
  - action: shell
    resource: '*'
    effect: deny
  - action: shell
    resource: 'pnpm clara rebuild health*'
    effect: allow
---

# Task: Verify health

Run exactly this command from the workspace:

```sh
pnpm clara rebuild health --json
```

The command probes every service that was captured as running, verifies the
orchestrator workspace, checks the Lab and home-agent endpoints, and confirms
the adapter link and agent file. It exits nonzero when an expected service or
adapter is unhealthy.

Return the JSON verbatim. If `ok` is false, call `clara_fail` with the failing
services, their endpoints, and the warnings. Do not attempt repairs, do not
restart anything, and do not run the rebuild again from this step.
