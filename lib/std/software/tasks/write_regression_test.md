---
description: Write the failing regression test for an identified bug
model: 'deepseek-v4.1-flash'
provider: 'opencode-go'
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
    resource: 'git diff *'
    effect: allow
  - action: shell
    resource: 'git status *'
    effect: allow
limits:
  turns:
    initial: 8
    absolute_max: 16
  tokens:
    initial: 80000
    absolute_max: 200000
---

# Task: Write the regression test

Write the test that reproduces the identified bug before the fix exists.

- Read `# Prior results` first: reuse the root cause and repro command from `identify_bug`. Do not repeat that investigation.
- If `# Previous attempt` is present, continue from its handoff.
- One focused test that fails on the current code for the reported reason.
- Name it after the failed behavior, not the fix.
- Stay inside tests and test files. Do not edit source.
- Run the test and capture the failure output.
- If the bug cannot be reproduced, stop and report why.

Return a compact JSON result with `testPath`, `command`, `failingOutput`, and `reproduced`.
