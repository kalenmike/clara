---
description: Install locked dependencies and build every Clara package
limits:
  turns:
    initial: 100
    growth_rate: 50
    absolute_max: 150
  tokens:
    initial: 1500000
    growth_rate: 1.5
    absolute_max: 2000000
  wall_clock_seconds: 1800
permissions:
  - action: edit
    resource: '*'
    effect: deny
  - action: shell
    resource: '*'
    effect: deny
  - action: shell
    resource: 'pnpm clara rebuild build*'
    effect: allow
---

# Task: Build Clara

Run exactly this command from the workspace:

```sh
pnpm clara rebuild build --json
```

The command runs `pnpm install --frozen-lockfile` and then `pnpm build` in the
captured build checkout. It prints the exit code, duration, and output tail for
each step.

Return the JSON verbatim. Do not restart services, install adapters, or change
dependencies. If the command exits nonzero, call `clara_fail` with the failing
step, its exit code, and the output tail. Do not retry with different commands.
