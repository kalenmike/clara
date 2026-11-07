---
description: Reproduce and identify a bug
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
    initial: 6
    absolute_max: 10
  tokens:
    initial: 50000
    absolute_max: 120000
---

# Task: Identify the bug

Reproduce the problem and identify the smallest correct fix.

- Capture the failing command and output.
- Identify the root cause, not just the symptom.
- Return the reproduction steps and the proposed fix scope.
