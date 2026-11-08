---
description: Implement the feature against the frozen tests
model: 'deepseek-v4.1-flash'
provider: 'opencode-go'
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
  - action: edit
    resource: 'workers/**/src/**'
    effect: allow
  - action: edit
    resource: 'plugins/**'
    effect: allow
  - action: edit
    resource: 'scripts/**'
    effect: allow
  - action: edit
    resource: 'tests/**'
    effect: deny
  - action: edit
    resource: '**/*.test.*'
    effect: deny
  - action: edit
    resource: '**/*.spec.*'
    effect: deny
  - action: edit
    resource: 'plugins/**/migrations/**'
    effect: deny
  - action: edit
    resource: '**/.env*'
    effect: deny
  - action: edit
    resource: '**/*.pem'
    effect: deny
  - action: edit
    resource: '**/*.key'
    effect: deny
  - action: edit
    resource: 'docs/**'
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
    initial: 16
    growth_rate: 2
    absolute_max: 32
  tokens:
    initial: 120000
    growth_rate: 1.5
    absolute_max: 400000
---

# Task: Build the feature

Implement the request against the frozen tests.

- Run focused tests at every progress boundary.
- Do not edit tests.
- If the spec and tests conflict, stop and report the conflict.
- Return a summary of changes, test results, and any remaining risk.
