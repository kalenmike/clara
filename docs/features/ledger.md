# Ledger

## Summary

The Clara ledger is an OpenCode plugin that records request state, acceptance
criteria, pipeline evidence, progress, decisions, and events in one SQLite
database. It gives the Clara agents a shared source of truth without passing
session history between them. A daemon turns that state into work by launching
the configured pipeline stages in child sessions, and turns exceptions into
Clara conversations in the session that owns the request.

A **request** is the unit of work: “write launch copy”, “sort these emails”, or
“add passkey login”. A [pipeline](pipeline.md) defines the stages that turn the
request into a result.

## User flow

1. Run `pnpm clara plugin install` from the Clara repository.
2. Enable **Clara management** in the agent panel. Turning it on is the master
   switch for the ledger daemon, exception sessions, and the Clara agents in
   OpenCode.
3. Select a pipeline for the workspace with
   `pnpm clara ledger pipeline select <workspace> <id>`, or rely on the built-in
   `software` pipeline.
4. Select the `clara` agent and submit a request with `clara_submit`.
5. Ask for status at any time with `clara_ask` or `clara_inbox`.
6. The daemon launches the contract stage. Its agent proposes criteria and calls
   `clara_stage_done`.
7. Approve the criteria with `clara_approve`; nothing runs before that.
8. Work stages run, followed by review stages. Each stage records its evidence
   with `clara_stage_done`; a stage with a human gate waits for
   `clara_stage_gate`.
9. The close stage records `result` and `artifacts`. Only the closer role can
   complete the request.
10. Resolve any open decision with `clara_resolve`. When a decision, approval,
    gate, stall, or budget needs a person, the daemon returns to the Clara
    session that owns the request.

## Feature boundary

Clara management is experimental and is isolated from ordinary session
management in three layers:

1. **Build inclusion.** `CLARA_MANAGEMENT` (server) and
   `VITE_CLARA_MANAGEMENT` (web and panel) exclude the feature when set to `0`,
   `false`, or `off`. The repository scripts default both to `1`, so a normal
   `pnpm build` or `pnpm dev` includes Clara management; override with
   `CLARA_MANAGEMENT=0 VITE_CLARA_MANAGEMENT=0 pnpm build`. An excluded build
   does not load the ledger modules and does not show the panel switch.
2. **Runtime switch.** `management.enabled` is the master switch. It defaults
   off. When off, the plugin does not open the ledger or register tools, the
   daemon is not constructed, and no exception sessions are opened.
3. **Uninstall.** `pnpm clara plugin uninstall` removes the plugin link and the
   generated agent files. Add `--purge` to remove the ledger database, the
   legacy delivery sidecar, the management setting, and the legacy delivery
   tables from the agent database.

A request stores the Clara session where the human submitted it. Every later
exception for that request is prompted into the same session. If the session is
missing, archived, or not a Clara session, the daemon creates one and writes it
back to the request. The `alerts` table stays as the deterministic outbox and
delivery record.

## Core business rules

1. **State crosses agent boundaries; sessions do not.** Every status answer
   comes from the ledger, never from a reconstructed conversation.
2. **The lifecycle is fixed.** Requests move through `draft`, `approved`,
   `running`, `review`, `completed`, or `cancelled`. Pipelines cannot add states.
3. **The contract is human-approved.** The contract stage proposes criteria; a
   human calls `clara_approve` before any work stage may start.
4. **Stages complete with evidence.** A stage agent calls `clara_stage_done`
   with the evidence its pipeline definition declares. A session that ends
   without it is a failed stage, not a silent advance.
5. **Evidence is durable.** Evidence is append-only. An immutable key, such as a
   test-suite hash, cannot be replaced by a later stage.
6. **Silence is never approval.** A decision defaults to `block` when nobody
   answers.
7. **Only the closer closes work.** The close stage uses `role: "closer"`. A
   worker can record progress and request review, never complete the request.
8. **Human gates are recorded, not inferred.** `clara_gate` records a
   human-verification criterion; `clara_stage_gate` records a pipeline stage
   gate. The closer cannot verify either on the human's behalf.
9. **The ledger is deterministic.** `clara_tick` is pure SQL and comparisons; it
   makes no model calls.
10. **The daemon spawns, the ledger decides.** A single-owner lock and the `runs`
    table keep one daemon and one live session per stage.
11. **Requests pin their pipeline.** A pipeline edit never reinterprets an
    in-flight request.
12. **Worker identity is metadata, not a title.** The daemon writes
    `automation: true` on worker sessions and `synthetic: true` on their handoff
    prompts. Clients use those markers to keep workers out of the human mailbox.

## Edge cases

- If the ledger cannot answer a question, it records a schema gap instead of
  guessing.
- If a workspace path does not exist, `clara_submit` skips the request record
  and says so.
- The actor is derived from the live run behind the session, not from the tool
  arguments. A worker cannot claim the closer role.
- An unknown agent with no live run has no write privileges.
- Illegal lifecycle transitions are rejected.
- A cancelled request records a reason code; terminal states cannot reopen.
- A second OpenCode location loads the plugin but cannot tick while the daemon
  lock heartbeat is fresh.
- The daemon restarts mid-stage; the `runs` row resumes the session instead of
  launching a duplicate.
- A worker session ends without completing its stage; the daemon opens one
  decision and retries only after the human resolves it.
- A reviewed request has unverified human gates; the closer opens a decision
  instead of closing.
- A request is cancelled while a worker is running; the daemon interrupts that
  session on its next tick.
- The workspace path is missing when a stage is due; the daemon opens a decision
  instead of creating a session.
- The host has no session API, or `daemon: false` / `CLARA_DAEMON=0` is set; the
  ledger still records state, but nothing is launched.
- Clara management is disabled; the plugin registers no tools, stays loaded
  without opening the ledger, and starts no daemon.
- An alert is delivered once even across an agent restart; the alert row keeps
  the session and delivery time.
- The request's session is missing, archived, a worker, or not a Clara session;
  the daemon creates a new one and writes it back to the request.
- A form is skipped or times out; Clara does not act, and the ledger exception
  stays open.
- The alert resolves while Clara is composing; `clara_attention` refuses the
  form and Clara stops.
- A stage gate is rejected after it was verified; the reopened alert clears its
  delivery marker so the exception reaches the session again.
- A request completes but its record is missing; the daemon leaves it
  uncommitted instead of inventing a file.
- The plugin falls back from `node:sqlite` to `bun:sqlite` at runtime.
- Migrations apply in filename order and are recorded in `schema_migrations`.

## Out of scope

- Worktree and branch creation; workers run in the workspace directory.
- Automatic approval or resolution; the human gates stay human.
- Cost rollups for accepted requests.
- A general web or panel view of requests, evidence, and progress; open
  exceptions are read with `clara_inbox` or raised in a Clara session.
- A pipeline editor; pipeline files and the CLI are the authoring surface.

## Known gaps

- The close gate does not execute an automated check. It trusts the evidence
  recorded by the stage that owns it.
- Workers run in the workspace directory. There is no separate worktree or
  branch per request yet.
- The daemon commits the request record with a system commit that carries the
  OpenCode co-author trailer, not a model trailer.
- `clara_attention` uses the session form API when the plugin exposes it. If the
  host does not, Clara falls back to a prose question and the standard composer.
- A confirmation is a boolean field plus the form's Submit control, not a
  single-click action.

## Technical appendix

<details>
<summary>Paths, tools, and install mechanics</summary>

- Plugin: `plugins/clara`
- Ledger: `${CLARA_DATA_DIR:-${XDG_DATA_HOME:-~/.local/share}/clara}/ledger.db`
- Override: `CLARA_LEDGER_DB_PATH` or the plugin `db` option
- Home agent settings database: `${CLARA_DATA_DIR:-${XDG_DATA_HOME:-~/.local/share}/clara}/clara.db` (separate)
- Pipeline files: `${CLARA_CONFIG_DIR:-~/.config/clara}/pipelines/*.json`
- Management switch: `management.enabled` in the home agent database, owned by
  the panel and read by the plugin. Changing it also toggles `disabled` in the
  generated agent files and reloads OpenCode. Default off.
- Uninstall: `pnpm clara plugin uninstall`; `--purge` also removes the ledger,
  the legacy delivery sidecar, the management setting, and legacy delivery
  tables.
- Daemon: `plugins/clara/daemon.ts` ticks every 15s, reconciles `runs`, and
  launches at most one missing stage per tick through the OpenCode session API.
  It exports `DAEMON_SESSION_METADATA` and `DAEMON_PROMPT_METADATA`.
- Stage resolution: `plugins/clara/runs.ts` reads the pinned snapshot, skips
  stages whose `when` condition is false, waits on gates, and returns the next
  stage or a lifecycle transition.
- Pipeline loader: `plugins/clara/pipeline.ts` validates definitions, hashes
  them, renders handoff templates, evaluates conditions, and provides the
  built-in `software` preset.
- Attention delivery: `plugins/clara/attention.ts` selects undelivered rows from
  `alerts`, resolves the request's session, and prompts it with a synthetic,
  queued handoff.
- Session links: `requests.session_id` and `workspaces.session_id` point at the
  conversation that owns the request. `alerts.session_id` and `notified_at`
  record delivery; `attention_state` records the last presentation Clara chose.
- Run state: `runs` (request, stage, agent, role, session, status) and
  `daemon_lock` (one heartbeat row shared by every plugin instance).
- Evidence: `evidence` (request, stage, key, JSON value, actor, time),
  `progress` (request, stage, metrics, blocker, next, tokens), and
  `stage_gates` (request, stage, position, result).
- Criteria: `verification` is `automated`, `human`, or `artifact`; `check_ref`
  holds a test path, command, artifact path, or other reference.
- Tools: `clara_submit`, `clara_attention`, `clara_inbox`, `clara_ask`,
  `clara_approve`, `clara_gate`, `clara_criteria`, `clara_stage_done`,
  `clara_stage_gate`, `clara_progress`, `clara_event`, `clara_decide`,
  `clara_resolve`, `clara_tick`.
- `clara_ask` reports the pipeline/stage, criteria, evidence, progress, runs,
  human-gate status, and an event summary, so the closer never needs the
  filesystem or a shell.
- Feature records: `docs/records/NNN-slug.md`, append-only and intentionally
  outside the canonical docs index. The daemon commits one when a request
  closes.
- CLI: `pnpm clara ledger list`, `run <tool> [json]`, and
  `pipeline list|validate|select|show`. The CLI calls the same tool definitions
  against the same ledger and derives the role from `--agent`.
- OpenCode discovers agents only from markdown or an `agents` config map, not
  from plugin code. The installer renders `agents.json`, and the home agent
  keeps the generated files' `disabled` field in sync with management.
- Migrations: `plugins/clara/migrations`.
- See [pipeline.md](pipeline.md) for the pipeline format and examples.

</details>
