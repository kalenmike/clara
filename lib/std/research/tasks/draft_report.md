---
description: Turn the verified evidence into a concise, linked human-readable report
limits:
  turns:
    initial: 100
    growth_rate: 50
    absolute_max: 150
  tokens:
    initial: 1500000
    growth_rate: 1.5
    absolute_max: 2000000
permissions:
  - action: edit
    resource: '*'
    effect: deny
  - action: shell
    resource: '*'
    effect: deny
---

# Task: Draft the report

Write the report from the verified evidence only. Do not add new research,
claims, sources, or dates in this step.

## Document shape

```markdown
# Title

## Executive summary

## Key findings

## Detail

## Conflicts, gaps, and limitations

## Sources
```

- The executive summary is the first thing a busy reader sees. Give the bottom
  line in three to five bullets or two short paragraphs.
- Key findings state what the evidence supports, with confidence and citations.
- Detail sections explain the parts that need more depth, organised by question
  or theme rather than by source.
- Conflicts, gaps, and limitations name uncertainty honestly.
- Sources is a dated table with title, publisher or author, publication date,
  access date, and URL.

## Writing rules

- Pull, do not push. Summarise the finding, add the citation, and link to the
  source for depth. Do not paste long passages, large tables, or whole articles
  into the report.
- Keep the detail proportional to the request. Include what changes the answer
  and cut what only demonstrates effort.
- Use inline links for every material claim, for example
  `[Source title](https://example.com/source)`.
- Include the publication date and access date for every cited source, in the
  source table and in any inline citation where it matters.
- Separate fact from interpretation. Label your own recommendations as
  recommendations.
- Use language that fits any industry. Do not assume software engineering,
  a codebase, or a technical audience.
- Do not invent quotations, URLs, numbers, or publication dates.
