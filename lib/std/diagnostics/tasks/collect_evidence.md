---
description: Run the deterministic orchestrator analyzer and return its report
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
    resource: 'pnpm clara orchestration analyze*'
    effect: allow
---

# Task: Collect evidence

Run the deterministic analyzer. Do not write your own SQL and do not inspect the
database directly.

```sh
pnpm clara orchestration analyze --json --days 30
```

- If the incoming request names a window such as "last 7 days", pass
  `--days 7`. The default is 30 days; `--days 0` means all history.
- If the request names a database file, add `--db <path>`.
- If the analyzer reports that the service is unreachable and no database is
  available, say so and return `{ "available": false, "reason": "..." }`.

## Required output

Return the analyzer JSON verbatim. Do not summarize it, do not reinterpret it,
and do not propose fixes in this step. The next steps consume the structured
fields directly.

If the command fails, return the exact command, exit status, and stderr. Do not
retry with a different database, invent rows, or reconstruct the report from
memory.
