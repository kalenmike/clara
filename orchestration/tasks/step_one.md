---
description: An example task
permissions:
  - action: edit
    resource: '*'
    effect: deny
  - action: edit
    resource: 'src/**'
    effect: allow
  - action: edit
    resource: 'apps/**/src/**'
    effect: allow
  - action: edit
    resource: 'packages/**/src/**'
    effect: allow
  - action: shell
    resource: '*'
    effect: deny
  - action: shell
    resource: 'pnpm *'
    effect: allow
  - action: shell
    resource: 'git *'
    effect: allow
limits:
  turns:
    initial: 6
    growth_rate: 2
    absolute_max: 12
  tokens:
    initial: 60000
    growth_rate: 1.5
    absolute_max: 180000
---

# Task: Apply a quick patch

Make the smallest correct code change that satisfies the request.

1. Read the relevant files.
2. Apply the patch.
3. Run the focused tests or typecheck.
4. Return a short summary of what changed and any remaining risk.
