---
description: Audit the diagnosis against evidence and return the final report
limits:
  turns:
    initial: 8
    growth_rate: 2
    absolute_max: 14
  tokens:
    initial: 60000
    growth_rate: 1.5
    absolute_max: 120000
permissions:
  - action: edit
    resource: '*'
    effect: deny
  - action: shell
    resource: '*'
    effect: deny
---

# Task: Review and return the diagnosis

Audit every issue and proposed fix against the evidence report and the files you
read. Remove anything you cannot support. Do not add new findings to make the
report look complete.

## Checklist

- Every count, rate, run id, signature, and step path traces to the evidence.
- Every file and field named in a fix exists.
- Confirmed, likely, and suspected are used correctly.
- Cancellations are not counted as failures.
- Single-run noise is not presented as a systemic problem.
- Duplicate issues and duplicate fixes are merged.
- The event storm and duplicate-alert anomalies are either explained or listed
  as open questions.
- No secret, token, raw prompt, or workspace-sensitive content is included.
- The report does not claim a fix was applied.

## Required output

Return the final Markdown report, ready to deliver:

```text
# Orchestrator diagnosis — <window>
## Verdict
## Evidence summary
## Issues
### ISSUE-1 [severity, confidence] title
- Signal
- Evidence
- Likely cause
- Proposed fix
- Verification
- Risk
## Watchlist and data-quality caveats
## Recommended next actions
```

Close with a short audit checklist showing pass or fix for each checklist item.
Keep the whole report under 1,500 words. Do not write files.
