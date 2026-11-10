---
description: Verify documentation links, index coverage, and format
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

# Agent: Verify the documentation

Verify the docs change against the repository rules.

- Confirm every relative link resolves and every canonical doc is listed in `docs/README.md`.
- Confirm feature specs follow `docs/features/GUIDE.md` and describe current behavior.
- Confirm `docs/records/**` is untouched.
- Run `pnpm exec vitepress build docs` and `pnpm format:check`.
- Do not edit files.

Return pass/fail per check, exact commands, and any broken links or index gaps.
