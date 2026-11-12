---
description: Turn the approved specification into an implementation plan
permissions:
  - action: edit
    resource: '*'
    effect: deny
  - action: shell
    resource: '*'
    effect: deny
limits:
  turns:
    initial: 100
    growth_rate: 50
    absolute_max: 150
  tokens:
    initial: 1500000
    growth_rate: 1.5
    absolute_max: 2000000
---

# Agent: Plan the implementation

Turn the specification into an executable plan before tests are frozen.

- Read `spec.md`, the request, and the source files the change touches.
- List the ordered changes, the files or packages affected, and the tests that will define done.
- Call out migrations, configuration, permissions, and user-visible behavior.
- Identify assumptions, risks, and anything the specification leaves open.
- Do not edit files or run commands.

Return the plan, the file map, the test strategy, and any blocking question.
