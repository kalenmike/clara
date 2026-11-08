# Orchestrator diagnostics

## Summary

The `std:diagnostics` package audits the orchestrator's own history and setup.
It runs a deterministic analyzer over the SQLite database, interprets the
failure patterns in a six-step pipeline, and returns a ranked report of bugs,
failure points, and proposed fixes. It is the self-analysis path for questions
such as why a pipeline keeps failing, which steps exhaust their retries, or
whether the watchdog and budgets are configured correctly.

## User flow

1. Ask Clara to diagnose the orchestrator, for example "why are my pipelines
   failing?" or "audit the orchestrator setup". The primary classifier routes
   the request to `std:diagnostics`.
2. A caller can also start the package directly with
   `target: std:diagnostics`, or run the analyzer without a pipeline with
   `pnpm clara orchestration analyze`.
3. `collect_evidence` runs
   `pnpm clara orchestration analyze --json --days 30`. The analyzer prefers a
   reachable orchestrator service and otherwise opens the local database
   read-only.
4. `pattern_failures` groups consistently failing pipelines and steps, repeated
   error signatures, retry exhaustion, stalls, budget failures, and alert
   anomalies such as event storms.
5. `audit_setup` reads the orchestration YAML, routers, and task documents and
   compares them with the evidence.
6. `rank_issues` merges related findings and assigns severity and confidence.
   `propose_fixes` gives the smallest concrete change, verification, and risk.
7. `review_report` checks every number and path against the evidence and returns
   the final Markdown report through the run result. No files are written.

## Core business rules

1. **Evidence is deterministic.** A SQL analyzer produces counts, signatures,
   and anomalies. The model may interpret the report, but it must not write its
   own SQL or reconstruct history from memory.
2. **Cancellations are not failures.** Failure rates use completed and failed
   runs. Cancelled runs are reported separately so a cancelled smoke test does
   not make the system look broken.
3. **Every issue cites evidence.** A finding must point to a count, signature,
   run id, step path, or file and field. Weak findings are labelled
   `suspected` or dropped.
4. **The pipeline reports; it does not repair.** It never edits files, mutates
   the database, deletes history, or applies a fix. A human decides what to
   change.
5. **It must run on a broken setup.** The package uses `observed` enforcement,
   so a missing or stale strict adapter does not prevent the diagnosis. The
   tasks themselves are read-only by prompt and permissions.
6. **The default window is 30 days.** `--days 0` analyzes all history. A request
   that names a window overrides the default.
7. **The report is bounded.** The analyzer caps signatures, step groups, sample
   run ids, and recent failures so a long-running database cannot flood the
   step context.

## Edge cases

- **No database:** the analyzer returns `{ "available": false, "reason": ... }`
  and the pipeline reports that history cannot be diagnosed instead of failing
  the run.
- **Service reachable but database unavailable:** the CLI calls
  `GET /v1/diagnostics`; it only opens the local file when no service is
  reachable and no `--db` is given.
- **Empty window:** the report has zero totals and no anomalies. The pipeline
  returns "not enough history" rather than inventing findings.
- **Duplicate terminal events:** a run that emits `run.failed` hundreds of times
  is reported as `terminal_event_storm`, not counted as hundreds of failures.
- **Stale adapters:** many historical adapter rows can remain registered. The
  report lists the ones with a heartbeat older than two minutes and treats a
  missing adapter for strict runs as a setup issue.
- **Partial runs:** active runs with old heartbeats are flagged as
  `stale_active_runs`; the pipeline does not silently treat them as completed.
- **Missing model or provider:** rows without a resolved model or provider are
  reported. The setup audit decides whether a default is genuinely missing or
  merely not recorded on an older row.
- **Large databases:** the analyzer reads aggregate rows and capped samples, not
  every event or prompt. A very large `events` table can still make the query
  slower; the command has a 10-second service timeout and falls back to the
  database.
- **Clock skew:** timestamps are parsed as ISO strings. Invalid timestamps fall
  back to the report clock and do not crash the analyzer.

## Out of scope

- Applying fixes, editing pipelines, or committing changes.
- Deleting or compacting historical runs, events, or alerts.
- Live monitoring, scheduled diagnosis, or paging on a new anomaly.
- External observability, model cost accounting, or provider health beyond the
  recorded models and adapter heartbeats.
- Explaining a failure that left no run, step, alert, or event evidence.

## Known gaps

- The analyzer groups a run by the deepest `route-*` step segment. A route key
  is not always the same as the pipeline name, so the report keeps the entry
  pipeline and the route key side by side.
- Adapter state is current, not historical. A run that failed while an adapter
  was live is not re-judged against the adapter state at that time.
- The pipeline does not persist its report. The result is delivered through the
  run and the origin session; there is no `docs/records` artifact.
- A containerized worker needs `CLARA_ORCHESTRATION_URL` and
  `CLARA_ORCHESTRATION_TOKEN` to use the service endpoint. Without them it needs
  a readable `CLARA_DATA_DIR` or `--db`.

## Technical appendix

<details>
<summary>Commands, data, and references</summary>

- Package: `lib/std/diagnostics`; entry pipeline `diagnose`; reference
  `std:diagnostics` or `std:diagnostics/diagnose`.
- Pipeline:
  `collect_evidence → pattern_failures → audit_setup → rank_issues →
propose_fixes → review_report`.
- Analyzer: `packages/orchestration/src/diagnostics.ts`;
  `analyzeDatabase(db, options)` and `analyzeDatabaseFile(path, options)`.
- CLI: `pnpm clara orchestration analyze [--json] [--days n] [--db path]
[--url url]`. Default window is 30 days; `--days 0` is all history.
- Service: `GET /v1/diagnostics?days=30`, bearer-protected, returns the same
  report as the CLI.
- Report fields: `window`, `runs`, `steps`, `pipelines`, `step_health`,
  `errors`, `alerts`, `anomalies`, and `recent_failures`.
- Anomaly codes: `terminal_event_storm`, `retry_exhaustion`,
  `stalled_dominance`, `open_alert_backlog`, `duplicate_alerts`,
  `no_completions`, `missing_model_provider`, `stale_adapter`,
  `adapter_missing`, `watchdog_churn`, `stale_active_runs`, and
  `runs_without_steps`.
- Data: `${CLARA_DATA_DIR:-~/.local/share/clara}/orchestration.db`.
- Tests: `packages/orchestration/test/diagnostics.test.ts` and
  `apps/orchestrator/test/cli.test.ts`.
- See [orchestration.md](orchestration.md) for packages, runs, and adapters.

</details>
