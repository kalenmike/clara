---
description: Define the research question, audience, scope, and evidence bar
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

# Task: Scope the research

Turn the incoming request into a research brief. Do not search the web or write
the final report yet.

## Required output

1. Restate the request in one sentence.
2. State the primary research question and three to six subquestions.
3. Identify the audience and the decision or action the report will support.
4. Define the scope: time window, geography, industry or domain, and any
   constraints stated in the request.
5. List explicit non-goals and questions that are out of scope.
6. State the source standard:
   - at least three independent sources for every material claim,
   - at least five distinct sources overall,
   - primary sources preferred over secondary summaries,
   - publication date and access date recorded for every source,
   - every material claim linked to a public URL that was actually opened.
7. Propose a short report outline with an executive summary, key findings,
   detail sections, conflicts or limitations, and a source appendix.

If the request is underspecified, state reasonable assumptions instead of
asking a question. If the request already sets a higher evidence bar, record
that bar and use it for the rest of the run. Do not use model memory as
evidence.
