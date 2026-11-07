---
description: Fix the identified bug
model: 'deepseek-v4.1-flash'
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
    initial: 8
    absolute_max: 16
  tokens:
    initial: 80000
    absolute_max: 200000
---

# Task: Fix the bug

Apply the smallest correct fix for the identified bug, then run the focused regression test.

Return the files changed, the verification command, and the result.
