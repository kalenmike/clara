---
description: Verify the implementation with the repository gates
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
    initial: 100
    growth_rate: 50
    absolute_max: 150
  tokens:
    initial: 1500000
    growth_rate: 1.5
    absolute_max: 2000000
---

# Task: Verify the implementation

Run the repository verification gates against the completed implementation.

- Run the focused tests first.
- Run `pnpm typecheck`, `pnpm lint`, and `pnpm format:check`.
- Run `pnpm check` and `pnpm build`.
- Do not edit files.
- If a gate fails, return the exact command and the relevant output.

Return pass/fail per gate, the exact commands, and any remaining risk.
