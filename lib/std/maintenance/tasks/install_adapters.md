---
description: Install or refresh the OpenCode adapter and MCP entry
limits:
  turns:
    initial: 4
    growth_rate: 2
    absolute_max: 8
  tokens:
    initial: 16000
    growth_rate: 1.5
    absolute_max: 32000
  wall_clock_seconds: 300
permissions:
  - action: edit
    resource: '*'
    effect: deny
  - action: shell
    resource: '*'
    effect: deny
  - action: shell
    resource: 'pnpm clara rebuild adapters*'
    effect: allow
---

# Task: Install the adapters

Run exactly this command from the workspace:

```sh
pnpm clara rebuild adapters --json
```

The command links the OpenCode adapter, installs the Clara agent file, and
refreshes the MCP entry when it was already configured. It does not restart
OpenCode; the running adapter stays live and OpenCode picks up the files on its
next start.

Return the JSON verbatim. Do not restart OpenCode, the orchestrator, or the home
agent. If the command exits nonzero, call `clara_fail` with the command and
error.
