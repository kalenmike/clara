---
description: Assess the documentation impact before editing
model: 'deepseek-v4.1-flash'
provider: 'opencode-go'
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
    initial: 4
    absolute_max: 8
  tokens:
    initial: 40000
    absolute_max: 100000
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
