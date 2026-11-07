---
description: Classify a software request into the feature, bug, or example lifecycle.
type: router
strategy: llm_classify
permissions:
  - action: edit
    resource: '*'
    effect: deny
  - action: shell
    resource: '*'
    effect: deny
limits:
  turns:
    initial: 1
    absolute_max: 2
  tokens:
    initial: 5000
    absolute_max: 10000
---

# Software router

Choose exactly one route from the work order.

[ROUTES]

Return only the route key and a one-sentence reason. Do not edit files or run commands.
