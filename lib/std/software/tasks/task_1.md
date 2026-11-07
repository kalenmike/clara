---
description: Prepare the example request
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
    initial: 2
    absolute_max: 4
  tokens:
    initial: 10000
    absolute_max: 20000
---

# Task: Prepare example

Summarize the incoming request and identify what the nested task group should evaluate.
