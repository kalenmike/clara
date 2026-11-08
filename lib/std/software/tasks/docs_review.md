---
description: Review documentation for accuracy and consistency
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
    initial: 6
    absolute_max: 10
  tokens:
    initial: 50000
    absolute_max: 120000
---

# Task: Review the documentation

Review the docs change for accuracy, scope, and consistency.

- Read the diff and the request.
- Check that docs describe current behavior, not history or plans.
- Check one canonical doc per topic, relative links, index coverage, and capabilities impact.
- Do not edit files.

Return findings ordered by severity and a clear approve/block recommendation.
