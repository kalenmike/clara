---
description: Verify the bug fix against the regression test and repository gates
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
    resource: 'git diff *'
    effect: allow
  - action: shell
    resource: 'git status *'
    effect: allow
limits:
  turns:
    initial: 6
    growth_rate: 1.5
    absolute_max: 12
  tokens:
    initial: 80000
    growth_rate: 1.5
    absolute_max: 240000
  on_exhausted: fail
retries:
  auto_attempts: 2
---

# Task: Verify the bug fix

Verify the fix against the regression test and the repository gates.

- Read `# Prior results` to get the changed files and the regression test path; do not re-derive them.
- If `# Previous attempt` is present, skip gates that already ran and passed.
- Run the regression test first; it must pass now.
- Run the focused suite for the affected package.
- Run `pnpm check` and `pnpm build`.
- Confirm the regression test was not changed by the fix.
- Do not edit files.

Return a compact JSON result with `gates` (each gate's pass/fail and command), `regressionUnchanged`, and `remainingRisk`.
