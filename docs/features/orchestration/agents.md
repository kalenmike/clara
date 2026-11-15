---
title: Agent and router documents
kind: reference
---

# Agent and router documents

Agent and router documents are Markdown with optional YAML frontmatter; the body
is the prompt.

## Agents

```markdown
---
id: code_review
model: a-model
limits: { turns: { initial: 20 } }
---

Review the implementation and report blocking issues.
```

Frontmatter keys are `id`, `description`, `model`, `provider`, `permissions`,
`policy`, `limits`, and `retries`. A step resolves the document named by its
`agent` field or by the step name, trying a `namespace:` prefix without the
namespace. A missing document is a diagnostic warning, not a load error.

## Routers

Router documents add `strategy`, `routes`, `enforcement`, and `requires`. The
body carries `[ROUTES]` or gets the rendered route list appended under
`## Routes`; the manifest `router` block can supplement or replace the file's
values. Every route needs `when` and `run`, and `criteria` (or legacy
`description`) tells the classifier when to choose it.

```markdown
---
id: classifier
strategy: llm_classify
---

Pick exactly one route.

[ROUTES]
```

A router returns exactly one `when` key. An unknown key or a missing control
call fails the step; prose is never inferred as a route. A router row stays done
once it records its route, and the selected branch carries any failure.
