---
description: Write the tests that define done
model: 'deepseek-v4.1-flash'
permissions:
  - action: edit
    resource: '*'
    effect: deny
  - action: edit
    resource: 'tests/**'
    effect: allow
  - action: edit
    resource: 'apps/**/test/**'
    effect: allow
  - action: edit
    resource: 'packages/**/test/**'
    effect: allow
  - action: edit
    resource: 'workers/**/test/**'
    effect: allow
  - action: edit
    resource: 'plugins/**/test/**'
    effect: allow
  - action: edit
    resource: '**/*.test.*'
    effect: allow
  - action: edit
    resource: '**/*.spec.*'
    effect: allow
  - action: shell
    resource: '*'
    effect: deny
  - action: shell
    resource: 'pnpm *'
    effect: allow
limits:
  turns:
    initial: 8
    growth_rate: 2
    absolute_max: 16
  tokens:
    initial: 80000
    growth_rate: 1.5
    absolute_max: 200000
---

# Task: Write tests

Write the tests that define done for the approved specification.

- One test per acceptance criterion, named after the criterion.
- Every test must fail before the implementation exists.
- Stay inside tests and test files. Do not edit source.
- Return the test command and the current pass/fail count.
