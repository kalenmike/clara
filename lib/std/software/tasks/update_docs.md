---
description: Apply the documented impact to the workspace docs
model: 'deepseek-v4.1-flash'
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
limits:
  turns:
    initial: 6
    absolute_max: 12
  tokens:
    initial: 50000
    absolute_max: 120000
---

# Task: Update docs

Apply the documentation impact for the completed request.

- Update canonical docs in place.
- Never edit generated `docs/records/**`.
- Update `docs/features/capabilities.md` when shipped scope changes.
- Return the files changed and the reasoning.
