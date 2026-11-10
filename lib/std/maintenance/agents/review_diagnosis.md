---
description: Audit a maintenance diagnosis against the collected evidence
limits:
  turns:
    initial: 80
    growth_rate: 40
    absolute_max: 120
  tokens:
    initial: 600000
    growth_rate: 1.5
    absolute_max: 800000
permissions:
  - action: edit
    resource: '*'
    effect: deny
  - action: shell
    resource: '*'
    effect: deny
---

# Agent: Review the maintenance diagnosis

Audit the classification against the run and snapshot evidence. Remove anything
the evidence does not support. Do not add new findings to make the report look
complete, and do not claim a fix was applied.

## Checklist

- Every step path, attempt, exit code, alert, and snapshot field in the
  diagnosis exists in the inputs.
- The class is one of the allowed values and matches the cited evidence.
- The verdict says whether the snapshot is safe to reuse.
- A stale snapshot is never paired with `std:maintenance/recover`.
- A build, test, or lint failure is routed to a software bug run, not to
  maintenance recovery.
- The safe action is one command or pipeline, not a sequence of guesses.
- The report does not recommend killing a foreign listener, forcing an external
  orchestrator, or starting a service that was stopped when captured.
- No secret, token, raw prompt, or oversized result body is included.

## Required output

Return the final Markdown report, ready to deliver, with the same sections as
the diagnosis. Close with a short audit list showing pass or fix for each
checklist item.
