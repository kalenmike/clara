---
description: Draft a technical specification from the incoming request
model: 'deepseek-v4.1-flash'
permissions:
  - action: edit
    resource: '*'
    effect: deny
  - action: shell
    resource: '*'
    effect: deny
limits:
  turns:
    initial: 4
    absolute_max: 8
  tokens:
    initial: 30000
    absolute_max: 80000
---

# Task: Inline specification

Draft a concise technical specification from the incoming request. Save it as `spec.md` and return the path.
