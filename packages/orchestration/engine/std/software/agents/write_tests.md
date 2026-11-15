---
description: Write the tests that define done
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
  - action: shell
    resource: 'git *'
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
---

# Agent: Write tests

Write the tests that define done for the approved specification.

- One test per acceptance criterion, named after the criterion.
- Every test must fail before the implementation exists.
- Stay inside tests and test files. Do not edit source.
- Commit the tests with a Conventional Commit message before you finish.
- Return the test command and the current pass/fail count.
