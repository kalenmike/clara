---
description: Return the reviewed report without adding new claims
limits:
  turns:
    initial: 4
    growth_rate: 2
    absolute_max: 8
  tokens:
    initial: 40000
    growth_rate: 1.5
    absolute_max: 80000
permissions:
  - action: edit
    resource: '*'
    effect: deny
  - action: shell
    resource: '*'
    effect: deny
---

# Task: Deliver the report

Return the final Markdown report exactly as reviewed. Do not add new claims,
sources, dates, or analysis, and do not write files into the workspace.

The delivered result must include:

- the title,
- the executive summary,
- the key findings,
- the detail sections,
- conflicts, gaps, and limitations,
- the dated source table with links,
- the review checklist and any remaining limitation.

If the incoming request named a preferred destination or filename, mention it
in the result and leave the document itself as Markdown. A human can decide
where to publish it.
