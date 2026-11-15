---
title: Keeping Clara healthy
---

# Keeping Clara healthy

## Summary

The `std:maintenance` package rebuilds and restores a local Clara installation,
and `std:diagnostics` audits the engine's own history and setup. Both run with
`observed` enforcement, so they work while an adapter or the setup is degraded;
deterministic mechanics live in `clara rebuild …`, `clara-engine inspect`, and
`clara-engine analyze`, and models only interpret.

## User flow

1. Ask Clara to "rebuild Clara", "recover the Clara services", or "diagnose why
   the rebuild failed". The classifier routes to `std:maintenance/rebuild`,
   `/recover`, or `/diagnose`; Clara Lab can start them directly.
2. `rebuild` captures the live setup, builds the checkout, reinstalls the
   configured adapters, restarts only the captured services, and verifies them.
3. `recover` restores services from the current snapshot without building.
4. `diagnose` reads one failed run plus the snapshot and proposes safe next
   actions; it never repairs.
5. Ask Clara to audit the engine, such as "why are my pipelines failing?". The
   router selects `std:diagnostics`, which collects evidence, interprets it, and
   returns a ranked Markdown report.

## Core business rules

1. **The snapshot is the contract.** `status` writes it; `restart`, `recover`,
   and `health` read it. A service captured as stopped stays stopped.
2. **Recovery uses the same snapshot.** Re-running `status` after a partial
   restart would record dead services as stopped, so only a new `rebuild` takes a
   new snapshot.
3. **Every automatic step is a script.** `rebuild` and `recover` have no model,
   prompt, or budget; the two read-only agents live only in `diagnose`.
4. **The engine restarts last.** The runner executes on the workspace host, so
   restarting the engine does not kill the run; the command waits for `/health`
   before reporting completion.
5. **Diagnosis is evidence-first.** A deterministic analyzer reads history, and
   every finding cites a count, signature, run id, step path, or file field. The
   pipeline reports and never edits, deletes, or applies a fix.

## Snapshot and deployment forms

`clara rebuild status` records the primary checkout, git revision, Node and pnpm
versions, adapter and MCP entries, every running engine, Lab, hub, and web
client, and each service's deployment form: `local`, `host`, or `stopped`, plus
an `external` flag for an engine managed outside the checkout. It writes
`${CLARA_DATA_DIR:-~/.local/share/clara}/rebuild/setup.json` (mode `0600`).

A service captured as a container is managed outside the installation: it is
reported and skipped, never signalled by PID. A snapshot older than two hours is
refused by `restart`, `recover`, and `health`; re-run `status` or pass `--force`.
Restart state lives in `rebuild/restart.json` and the log in `rebuild/rebuild.log`.

## Rebuild and recovery

`rebuild` runs `pnpm install --frozen-lockfile` and `pnpm build` in the captured
checkout, links the OpenCode adapter, installs the Clara agent file, refreshes a
previously configured MCP entry, then restarts the captured services in their
captured form: web, Lab, and hub first, engine last, waiting on each endpoint.
Adapters are installed, not hot-reloaded; OpenCode picks them up on its next
start because restarting it would kill the worker running the pipeline.

`recover` probes health, restarts only services that are both expected and
unhealthy, and re-runs health. It never restarts a healthy service, starts one
that was stopped at capture, or re-captures the snapshot.

Restart and health retry once, then run a bounded `on_failure` branch that calls
`clara rebuild recover`. If recovery or the retry fails, the run fails with both
errors and one alert. A failed build, install, or adapter step stops the run with
the command, exit code, and output tail; no service is restarted. A
non-loopback engine is verified but not restarted unless the operator passes
`--manage-external`.

## Diagnostics audit

`std:diagnostics` runs `collect_evidence`, `pattern_failures`, `audit_setup`,
`rank_issues`, `propose_fixes`, and `review_report`. Evidence comes from
`clara-engine analyze --json --days 30`, which prefers a reachable engine service
and otherwise opens the local database read-only; `--days 0` analyzes all
history. The interpretation agents never edit files or mutate the database, and
the report is delivered through the run result, not written to disk.

Failure rates use completed and failed runs; cancellations are reported
separately. The analyzer caps signatures, step groups, sample run ids, and recent
failures so a long-running database cannot flood the step context. It reports
anomalies such as `terminal_event_storm`, `terminal_run_live_steps`,
`retry_exhaustion`, `stalled_dominance`, `stale_adapter`, `stale_active_runs`,
and `missing_model_provider` rather than re-judging history.

For one failed maintenance run, use `std:maintenance/diagnose` instead: it reads
that run's steps, attempts, exit codes, alerts, and the snapshot health, journal,
and log tail, then returns a classification and one safe next action. A build or
test failure is routed to a software bug run, not to maintenance recovery.

## Edge cases

- No database: the analyzer returns `{ available: false, reason }` and the
  pipeline reports that history cannot be diagnosed instead of failing the run.
- An empty window: the report has zero totals and the pipeline says there is not
  enough history rather than inventing findings.
- A completed or cancelled run still has a live step: it is reported as
  `terminal_run_live_steps`; the analyzer does not rewrite the rows.
- The Lab started this run: restarting it kills the debug dispatcher, so pass
  `--skip lab`.
- A script has no runner: the step stays ready and one `no_runner` alert opens.
- `diagnose` has no snapshot: `rebuild inspect` accepts exit 1, so the run still
  reports the failed step without snapshot-based recovery.

## Out of scope

- Deploying the relay Worker or the web client to Cloudflare Pages.
- Updating dependencies, changing the lockfile, or migrating the database.
- Restarting OpenCode or reloading its plugins mid-run.
- Starting services that were stopped when the pipeline started.

## Known gaps

- A manually started hub can lose environment-only credentials when its process
  environment is not readable; a systemd-managed hub does not.
- An old snapshot that captured a service as a container is skipped; re-run
  `clara rebuild status` after starting it on the host.
- `diagnose` selects the latest failed root run unless the request names one.

## Technical appendix

<details>
<summary>Commands, state, and endpoints</summary>

- Pipelines: `std:maintenance/rebuild`, `/recover`, `/diagnose`, and
  `std:diagnostics` at `packages/orchestration/engine/std/`.
- CLI: `clara rebuild status|build|adapters|restart|health|inspect|recover`
  with `--json`, `--root`, `--state`, `--dry-run`, `--manage-external`,
  `--force`, `--skip <service>`, `--lines`, and `--mcp`.
- Evidence: `clara-engine inspect [--run <id> | --request <path> |
--request-env] [--json]`; `--request-env` reads `CLARA_REQUEST` in a script.
- Analysis: `clara-engine analyze [--json] [--days n] [--db path] [--url url]`
  and `GET /v1/diagnostics?days=30`; the analyzer is
  `packages/orchestration/engine/src/diagnostics.ts`.
- Health: engine `/health` and `/v1/config`, Lab `/api/health`, panel and local
  hub `/health`, web `/healthz`; the panel's detailed status needs a session.
- Restart order: web, Lab, hub, engine, using systemd when active, then the
  captured PID.
- See [execution.md](execution.md) for runs and leases and
  [../capabilities.md](../capabilities.md) for shipped scope.

</details>
