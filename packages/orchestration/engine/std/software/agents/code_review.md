---
description: Review the implementation against the specification
permissions:
  - action: edit
    resource: '*'
    effect: deny
  - action: shell
    resource: '*'
    effect: deny
  - action: shell
    resource: 'git diff *'
    effect: allow
  - action: shell
    resource: 'git status *'
    effect: allow
limits:
  turns:
    initial: 100
    growth_rate: 50
    absolute_max: 150
  tokens:
    initial: 1500000
    growth_rate: 1.5
    absolute_max: 2000000
  on_exhausted: fail
retries:
  auto_attempts: 2
---

# Agent: Code review

Review the implementation for correctness, scope, security, and test quality.

- Read the diff and the specification.
- Do not edit files.
- Return findings ordered by severity and a clear approve/block recommendation.
