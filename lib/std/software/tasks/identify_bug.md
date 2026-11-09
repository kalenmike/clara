---
description: Reproduce and identify a bug
permissions:
  - action: edit
    resource: '*'
    effect: deny
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
    initial: 8
    absolute_max: 14
  tokens:
    initial: 60000
    absolute_max: 140000
---

# Task: Identify the bug

Reproduce the problem before proposing a fix.

- Capture the exact failing command, input, and output.
- Identify the root cause, not just the symptom.
- Name the smallest scope that can correct it and the regression test that will prove it.
- Note related behavior that must not change.
- Do not edit files.

Return reproduction steps, failing output, root cause, proposed fix scope, and the regression test to add.
