---
description: Apply the documented impact to the workspace docs
permissions:
  - action: edit
    resource: '*'
    effect: deny
  - action: edit
    resource: 'docs/**'
    effect: allow
  - action: edit
    resource: 'docs/records/**'
    effect: deny
  - action: shell
    resource: '*'
    effect: deny
  - action: shell
    resource: 'git diff *'
    effect: allow
  - action: shell
    resource: 'git status *'
    effect: allow
  - action: shell
    resource: 'pnpm exec prettier *'
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
  on_exhausted: fail
retries:
  auto_attempts: 2
---

# Task: Update docs

Apply the documentation impact for the completed request.

- Rewrite canonical docs in place; do not append "Update:" sections.
- Add new canonical docs to `docs/README.md` and keep the index complete.
- Never edit generated `docs/records/**`.
- Update `docs/features/capabilities.md` when shipped scope changes.
- Keep relative links resolving and follow `docs/features/GUIDE.md` for feature specs.
- Return the files changed and the reasoning.
