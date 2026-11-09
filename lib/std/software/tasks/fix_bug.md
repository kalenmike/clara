---
description: Fix the identified bug against the frozen regression test
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
    initial: 10
    growth_rate: 1.5
    absolute_max: 18
  tokens:
    initial: 120000
    growth_rate: 1.5
    absolute_max: 360000
  on_exhausted: fail
retries:
  auto_attempts: 3
---

# Task: Fix the bug

Apply the smallest correct fix for the identified root cause.

- Read `# Prior results` first: the root cause, repro command, and the frozen test path are already there.
- If `# Previous attempt` is present, continue from its handoff instead of repeating it.
- The regression test is frozen. Do not edit tests.
- Keep the change inside the identified fix scope.
- Run the regression test and the focused suite after the change.
- If the fix requires a broader change or a migration, stop and report why.

Return a compact JSON result with `filesChanged`, `commands`, `passFail`, and `remainingRisk`.
