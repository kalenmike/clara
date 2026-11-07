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
    run: feature
  - when: bug
    run: bug
---

# Example router

Choose `feature` for new work or `bug` for a regression. Return only the route key.
