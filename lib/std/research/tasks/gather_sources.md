---
description: Gather external, dated evidence with a search trail and source ledger
limits:
  turns:
    initial: 20
    growth_rate: 2
    absolute_max: 40
  tokens:
    initial: 180000
    growth_rate: 1.5
    absolute_max: 400000
permissions:
  - action: edit
    resource: '*'
    effect: deny
  - action: shell
    resource: '*'
    effect: deny
---

# Task: Gather external evidence

Use live external web search and page retrieval. Do not answer from model
memory or treat internal knowledge as a source. Open the pages you cite rather
than relying on search snippets.

## Requirements

- Record every search query you run.
- Prefer primary sources: official publications, filings, standards, research
  papers, datasets, and first-party statements. Use secondary sources for
  context and cross-checking.
- Aim for at least three independent sources per material claim and at least
  five distinct sources overall, unless the request sets a higher bar.
- Independence matters: different publishers or authors, not syndicated copies,
  the same press release, or one source repeated in several places.
- For each source, record its title, publisher or author, canonical URL,
  publication date, access date, source type, and the claims it supports.
- Use `undated` when no publication date is available and explain why.
- Keep short notes and links. Do not copy long passages from the source.
- If external search is unavailable, returns no usable results, or you cannot
  open any sources, treat this as a failed step and report the blocker. Do not
  invent URLs or reconstruct sources from memory.

## Required output

Return the search trail and a source ledger in Markdown:

| ID  | Title | Publisher or author | URL | Published | Accessed | Type | Supports |
| --- | ----- | ------------------- | --- | --------- | -------- | ---- | -------- |

Below the ledger, list the material claims identified so far and the source IDs
that support each one. Flag any claim that still lacks three independent
sources so the verification step can close the gap.
