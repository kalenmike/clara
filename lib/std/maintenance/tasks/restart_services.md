---
description: Restart the services captured as running, orchestrator last
limits:
  turns:
    initial: 6
    growth_rate: 2
    absolute_max: 12
  tokens:
    initial: 24000
    growth_rate: 1.5
    absolute_max: 48000
  wall_clock_seconds: 900
permissions:
  - action: edit
    resource: '*'
    effect: deny
  - action: shell
    resource: '*'
    effect: deny
  - action: shell
    resource: 'pnpm clara rebuild restart*'
    effect: allow
---

# Task: Restart the captured services

Run exactly this command from the workspace:

```sh
pnpm clara rebuild restart --json
```

The command restarts only the services that were running in the captured
snapshot. It restarts the Lab and the home agent first and the orchestrator
last, waits for each `/health` check, and resumes from its journal if a previous
attempt was interrupted. An orchestrator managed outside this checkout is
skipped unless the operator passed `--manage-external`.

This step can restart the orchestrator that owns the current run. The command is
detached from that process and waits for the service to answer before it
returns. If the command returns while the service is still restarting, wait a
few seconds and retry the command once; the journal prevents a second restart.

Return the JSON verbatim. If the command exits nonzero, call `clara_fail` with
the failing service, error, and log path. Do not start a service that was
stopped, do not restart OpenCode, and do not edit the snapshot.
