---
description: Review documentation for accuracy and consistency
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

# Task: Review the documentation

Review the docs change for accuracy, scope, and consistency.

- Read the diff and the request.
- Check that docs describe current behavior, not history or plans.
- Check one canonical doc per topic, relative links, index coverage, and capabilities impact.
- Do not edit files.

Return findings ordered by severity and a clear approve/block recommendation.
