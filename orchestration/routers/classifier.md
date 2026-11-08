---
description: Classify an incoming request and dispatch it to the right package or local pipeline.
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

# Primary router

Choose exactly one route.

[ROUTES]
