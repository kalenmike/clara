---
description: Reproduce and identify a bug
permissions:
  - action: edit
    resource: '*'
    effect: deny
  - action: shell
    resource: '*'
    effect: deny
  - action: shell
    resource: 'pnpm *'
    effect: allow
  - action: shell
    resource: 'git *'
    effect: allow
limits:
  turns:
    initial: 8
    growth_rate: 1.5
    absolute_max: 14
  tokens:
    initial: 80000
    growth_rate: 1.5
    absolute_max: 240000
  on_exhausted: fail
retries:
  auto_attempts: 2
---

# Task: Identify the bug

Reproduce the problem before proposing a fix.

- Start from the request. If `# Prior results` already names files or commands, read only what you need instead of re-scanning the repository.
- If `# Previous attempt` is present, continue from its handoff; do not repeat the investigation it already did.
- Capture the exact failing command, input, and output.
- Identify the root cause, not just the symptom.
- Name the smallest scope that can correct it and the regression test that will prove it.
- Note related behavior that must not change.
- Do not edit files.

Return a compact JSON result with `rootCause`, `fileLine`, `reproCommand`, `failingOutput`, `fixScope`, and `regressionTest`. Later steps read this result instead of repeating the investigation.
