---
description: Route the example pipeline to a real lifecycle
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
routes:
  - when: feature
    criteria: new work.
    run: feature
  - when: bug
    criteria: a regression.
    run: bug
---

# Example router

Choose exactly one route from the work order.

[ROUTES]

Return only the route key.
