---
description: Audit citations, dates, source counts, and report readability
limits:
  turns:
    initial: 10
    growth_rate: 2
    absolute_max: 20
  tokens:
    initial: 120000
    growth_rate: 1.5
    absolute_max: 200000
permissions:
  - action: edit
    resource: '*'
    effect: deny
  - action: shell
    resource: '*'
    effect: deny
---

# Task: Review the report

Audit the draft against the verified evidence. Fix every issue you can without
adding new research. If a claim cannot be traced, remove it or mark it clearly
as unverified.

## Checklist

- Every material claim traces to at least three independent sources, and the
  report cites at least five distinct sources overall, unless the request set a
  higher bar.
- Every source has a title, publisher or author, canonical URL, publication date
  or `undated`, and access date.
- Every inline link points to a source in the ledger and actually supports the
  claim it is attached to.
- The executive summary stands alone and matches the detailed findings.
- Conflicts, gaps, and uncertainty are stated rather than hidden.
- The report links out for depth instead of copying long source material.
- The detail is proportionate: nothing overloaded, repetitive, or included only
  to show effort.
- The language is neutral and works across industries.
- No invented URLs, dates, quotations, or numbers remain.

## Required output

Return the final Markdown report, ready to deliver, followed by a short audit
checklist showing pass or fix for each item above. State any remaining
limitation explicitly. Do not add new claims to make the checklist pass.
