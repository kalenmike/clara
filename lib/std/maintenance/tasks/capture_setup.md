---
description: Capture the running Clara services, adapters, and build checkout
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
  - action: shell
    resource: 'pnpm clara rebuild status*'
    effect: allow
---

# Task: Capture the current setup

Run exactly this command from the workspace:

```sh
pnpm clara rebuild status --json
```

The command records the primary checkout, the git revision, the adapters, and
every Clara service that is currently running. It writes the snapshot used by
the later steps and prints it as JSON.

Return the JSON verbatim. Do not build, install, restart, stop, or repair
anything. A stopped service is valid data: the restart step will leave it
stopped.

If the command fails, return the exact command, exit status, and stderr. Do not
retry with a different checkout or reconstruct the snapshot from memory.
