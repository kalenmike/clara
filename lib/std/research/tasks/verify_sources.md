---
description: Cross-check each material claim against independent dated sources
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

# Task: Verify the evidence

Audit the source ledger and every material claim before the report is written.

## Verification rules

- Each material claim must be supported by at least three independent sources
  and the report must cite at least five distinct sources overall, unless the
  incoming request sets a higher bar.
- Independent means different publishers or authors. Syndicated copies, the
  same press release, and one source repeated in several places count once.
- Re-open each cited URL and confirm that it actually supports the claim.
- Record the publication date and access date for every source. Check whether
  the evidence is current enough for the question.
- Look for contradictions, partial agreement, and stale information. Report
  them instead of smoothing them over.
- Run targeted follow-up searches to close gaps. If a claim still has fewer than
  three independent sources, remove it from the findings or mark it explicitly
  as unsupported and low confidence.
- Do not use model memory to fill a gap. Do not invent a source, URL, date, or
  quotation.

## Required output

Return a verification matrix:

| Claim | Supporting source IDs | Independent sources | Published dates | Confidence | Conflicts or gaps |
| ----- | --------------------- | ------------------- | --------------- | ---------- | ----------------- |

Then return:

- the final source ledger, with every source dated and linked,
- a list of claims that were removed or labelled low confidence, and why,
- any remaining gaps and the additional search that would close them.

If the previous step contains no external URLs or no search trail, treat this
as a failed step and report `external evidence missing`. Never reconstruct the
research from memory.
