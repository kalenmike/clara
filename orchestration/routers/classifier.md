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

Select exactly one route key from the list in the work order.

- `software-development` — a normal software feature, bug, or example request.
- `quick-patch` — a small, local lifecycle patch with no full spec cycle.

Return only the route key and a one-sentence reason. Do not edit files or run commands.
