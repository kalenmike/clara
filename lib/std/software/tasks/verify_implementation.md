---
description: Verify the implementation with the repository gates
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
    resource: 'git diff *'
    effect: allow
  - action: shell
    resource: 'git status *'
    effect: allow
limits:
  turns:
    initial: 8
    absolute_max: 14
  tokens:
    initial: 80000
    absolute_max: 180000
---

# Task: Verify the implementation

Run the repository verification gates against the completed implementation.

- Run the focused tests first.
- Run `pnpm typecheck`, `pnpm lint`, and `pnpm format:check`.
- Run `pnpm check` and `pnpm build`.
- Do not edit files.
- If a gate fails, return the exact command and the relevant output.

Return pass/fail per gate, the exact commands, and any remaining risk.
