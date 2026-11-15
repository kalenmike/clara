---
description: Draft a technical specification from the incoming request
permissions:
  - action: edit
    resource: '*'
    effect: deny
  - action: edit
    resource: 'spec.md'
    effect: allow
  - action: shell
    resource: '*'
    effect: deny
  - action: shell
    resource: 'git *'
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

# Agent: Create specification

Analyze the incoming request and produce a specification before code is written.

1. Identify the user-visible outcome, edge cases, non-goals, and constraints.
2. Define any API, data, or schema changes.
3. Save the final specification as `spec.md` in the project root.
4. Commit it with a Conventional Commit message (`docs: add the specification` or similar).
5. Return the path and a short summary.

Do not edit source code. Leave the worktree clean before you finish.
