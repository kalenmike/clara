---
description: Verify documentation links, index coverage, and format
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
    initial: 6
    absolute_max: 12
  tokens:
    initial: 60000
    absolute_max: 140000
---

# Task: Verify the documentation

Verify the docs change against the repository rules.

- Confirm every relative link resolves and every canonical doc is listed in `docs/README.md`.
- Confirm feature specs follow `docs/features/GUIDE.md` and describe current behavior.
- Confirm `docs/records/**` is untouched.
- Run `pnpm exec vitepress build docs` and `pnpm format:check`.
- Do not edit files.

Return pass/fail per check, exact commands, and any broken links or index gaps.
