---
description: Verify a quick patch
model: 'deepseek-v4.1-flash'
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
    initial: 4
    absolute_max: 8
  tokens:
    initial: 40000
    absolute_max: 100000
---

# Task: Verify the quick patch

Run the narrowest useful verification for the change: focused tests, typecheck, or a build.

Return pass/fail, the exact command, and any failure output. Do not edit files.
