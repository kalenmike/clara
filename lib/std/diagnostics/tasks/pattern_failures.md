---
description: Find consistent failures, error families, and retry patterns in the evidence
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

# Task: Pattern the failures

Use only the evidence report from the previous step. Do not add runs, counts, or
error text that is not in it.

## What counts as a pattern

- A **consistent failure** is a step or pipeline with failures in at least two
  distinct runs, or a failure rate of at least 50% with at least three attempts.
- A **repeated reason** is an error signature that appears in more than one run
  or more than one step, or that dominates a category.
- A **retry pattern** is retry exhaustion, repeated retries with the same
  signature, or a retry that never reaches a different outcome.
- A **systemic pattern** is stalled work, expired leases, budget exhaustion,
  routing failures, or setup errors that explain several runs at once.
- Cancellations are not failures. Mention them only when they hide the real
  failure rate.

## What to report

For each pattern:

- `PATTERN-n`: short title
- kind: consistent-failure, repeated-reason, retry, systemic, data-quality
- affected pipeline(s), step name(s), and step paths
- evidence: counts, failure rate, distinct runs, trend, first/last seen
- whether it is confirmed by direct evidence or only correlated

Call out explicitly:

- the top three failure signatures by count and category,
- steps where attempts reached `max_attempts`,
- any `terminal_event_storm`, `duplicate_alerts`, `open_alert_backlog`,
  `watchdog_churn`, `stale_adapter`, `missing_model_provider`, or
  `no_completions` anomaly in the evidence,
- any category whose trend is `rising`.

Return at most 12 patterns. Keep each to four lines. Do not propose fixes yet.
