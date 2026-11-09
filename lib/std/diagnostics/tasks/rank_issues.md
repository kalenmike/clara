---
description: Merge and rank failure patterns and setup findings into issues
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

# Task: Rank the issues

Merge the `PATTERN-n` and `SETUP-n` findings into a ranked issue list. Do not
invent evidence and do not carry a finding forward unless it is supported by the
analyzer report or a file you actually read.

## Ranking

- **critical**: blocks every run, loses data, or makes the service unusable.
- **high**: repeated failures, retry exhaustion, no successful runs, or a broken
  adapter that silently disables strict enforcement.
- **medium**: degraded reliability, avoidable retries, noisy alerts, or a setup
  value that will fail under load.
- **low**: hygiene, ambiguity, or a single low-impact occurrence.

Label confidence:

- **confirmed**: direct counts, paths, or configuration prove it.
- **likely**: several signals point the same way, but one link is inferred.
- **suspected**: plausible and worth watching, with weak evidence.

## Rules

- Merge findings with the same root cause; keep separate those with separate
  fixes.
- Drop single-occurrence noise unless the impact is severe.
- Never change a count or a run id to make a story fit.
- Keep at most 10 issues.

## Required output

For each issue:

`ISSUE-n` — title

- severity / confidence
- affected pipelines, steps, and files
- evidence: exact counts, signatures, trends, and run ids from the report
- impact in one sentence

Do not propose fixes yet.
