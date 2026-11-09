---
description: Assess the documentation impact before editing
permissions:
  - action: edit
    resource: '*'
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

# Task: Assess documentation impact

Identify the documentation work before editing.

- Read the request and the canonical docs that describe the affected behavior.
- List the docs to rewrite, the `docs/README.md` index rows to add or change, and any `docs/features/GUIDE.md` shape requirements.
- State whether shipped scope changes and whether `docs/features/capabilities.md` must change.
- Call out stale or conflicting statements that must be removed, not appended.
- Never plan edits to `docs/records/**`.
- Do not edit files.

Return the doc plan, files affected, index changes, and any open question.
