---
description: Turn the approved specification into an implementation plan
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
    initial: 6
    absolute_max: 10
  tokens:
    initial: 60000
    absolute_max: 140000
---

# Task: Plan the implementation

Turn the specification into an executable plan before tests are frozen.

- Read `spec.md`, the request, and the source files the change touches.
- List the ordered changes, the files or packages affected, and the tests that will define done.
- Call out migrations, configuration, permissions, and user-visible behavior.
- Identify assumptions, risks, and anything the specification leaves open.
- Do not edit files or run commands.

Return the plan, the file map, the test strategy, and any blocking question.
