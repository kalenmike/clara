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

Choose `rebuild` only when the request explicitly asks to rebuild Clara itself,
reinstall its adapters, restart all local Clara services, or verify their health
after a rebuild. Ordinary feature, bug, documentation, content, research, and
diagnostic work must use its own route.

[ROUTES]
