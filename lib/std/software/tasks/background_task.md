---
description: Run an independent background check
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
    initial: 3
    absolute_max: 6
  tokens:
    initial: 20000
    absolute_max: 50000
---

# Task: Background check

Inspect the request for risks that should block implementation. Return a short risk list.
