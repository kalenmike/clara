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
    absolute_max: 12
  tokens:
    initial: 60000
    absolute_max: 140000
---

# Task: Verify the bug fix

Verify the fix against the regression test and the repository gates.

- Run the regression test first; it must pass now.
- Run the focused suite for the affected package.
- Run `pnpm check` and `pnpm build`.
- Confirm the regression test was not changed by the fix.
- Do not edit files.

Return pass/fail per gate, the exact commands, and any remaining risk.
