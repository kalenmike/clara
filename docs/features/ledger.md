# Ledger

## Summary

The Clara ledger is an OpenCode plugin that records feature state, acceptance
criteria, decisions, checkpoints, and events in one SQLite database. It gives
the Clara agents a shared source of truth without passing session history
between them. A daemon turns that state into work by launching the spec, test,
build, docs, and judge agents in child sessions.

## User flow

1. Run `pnpm clara:plugin:install` from the Clara repository.
2. Enable **Clara management** in the agent panel. Turning it on is the master
   switch for the ledger daemon, ledger alerts, the Clara inbox, and the Clara
   agents in OpenCode.
3. The `clara`, `001`–`004`, and `judge` agents appear while the switch is on.
   The home agent rewrites their generated files and reloads OpenCode whenever
   the switch changes, so no reinstall is needed.
4. Select the `clara` agent and submit a feature with `clara_submit`.
5. Ask for status at any time with `clara_ask` or `clara_inbox`.
6. Approve the proposed criteria with `clara_approve`; nothing builds before
   that.
7. The daemon launches the spec agent to propose criteria; after approval it
   launches the test, build, docs, and judge agents as each stage completes.
8. At `review`, the person verifies the human-gate criteria with `clara_gate`;
   the daemon launches the docs agent when there is a docs impact, then the
   judge. The judge closes only when every gate is recorded.
9. Resolve any open decision with `clara_resolve`. Only `ai_0` can mark a
   feature done.
10. Open **Clara inbox** in the web client, or wait for a ledger alert, to see
    decisions, approvals, gates, stalls, and budget exceptions from every paired
    device.

## Core business rules

1. **State crosses agent boundaries; sessions do not.** Every status answer
   comes from the ledger, never from a reconstructed conversation.
2. **Silence is never approval.** A decision defaults to `block` when nobody
   answers.
3. **Only the supervisor closes work.** An implementer can request `review`;
   only `ai_0` can move a feature to `done` or `scrapped`.
4. **Tests are frozen.** The test agent records a hash and the build agent
   cannot edit test paths. The close gate requires the hash to be present.
5. **Human gates are recorded, not inferred.** `clara_gate` is the only way to
   record a human-gate check. The judge cannot verify one and opens a decision
   when it is missing.
6. **The ledger is deterministic.** `clara_tick` is pure SQL and comparisons;
   it makes no model calls.
7. **The daemon spawns, the ledger decides.** The `clara` agent never launches
   a worker. A single-owner lock and the `runs` table keep one daemon and one
   live session per stage.
8. **One master switch.** `management.enabled` in the home agent panel gates
   the daemon, the tools, ledger alerts, the Clara inbox, and the Clara agent
   catalog. When it is off, ordinary OpenCode session alerts continue unchanged.
9. **The ledger records exceptions; the home agent delivers them.** The plugin
   writes the `alerts` outbox and never sends push or a system notification.
   The home agent reads it read-only and owns delivery and deduplication.

## Edge cases

- If the ledger cannot answer a question, it records a schema gap instead of
  guessing.
- If a workspace path does not exist, `clara_submit` skips the feature record
  and says so.
- The actor is derived from the calling agent, so an implementer cannot spoof
  `ai_0`.
- Illegal state transitions are rejected.
- A killed feature records a reason code; terminal states cannot reopen.
- A second OpenCode location loads the plugin but cannot tick while the daemon
  lock heartbeat is fresh.
- The daemon restarts mid-stage; the `runs` row resumes the session instead of
  launching a duplicate.
- A worker session ends without advancing the ledger; the daemon opens a
  decision and retries only after the human resolves it.
- A reviewed feature has unrecorded human gates; the judge opens one decision
  instead of closing.
- A feature is killed while a worker is running; the daemon interrupts that
  session on its next tick.
- The workspace path is missing when a stage is due; the daemon opens a
  decision instead of creating a session.
- The host has no session API, or `daemon: false` / `CLARA_DAEMON=0` is set;
  the ledger still records state, but nothing is launched.
- Clara management is disabled; every `clara_*` tool refuses, the daemon stays
  loaded but idle, and the panel marks the generated agent files disabled and
  reloads OpenCode so the agents leave the catalog. Agent files edited after
  installation are reported and left untouched.
- The home agent database is missing; management defaults to off.
- A ledger alert is delivered once even across an agent restart; the delivery
  cursor and keys live in the home agent database, not the ledger.
- A feature closes but its record is missing; the daemon leaves it uncommitted
  instead of inventing a file.
- The plugin falls back from `node:sqlite` to `bun:sqlite` at runtime.
- Migrations apply in filename order and are recorded in `schema_migrations`.
- The previous scratch ledger is not reused; a fresh database is created on
  first load at the new path.

## Out of scope

- Worktree and branch creation; workers run in the workspace directory
- Automatic approval or resolution; the human gates stay human
- Cost rollups for accepted features
- Scrap-reason classification for `spec`, `context`, `model`, and `taste`
- A general web or panel view of features, criteria, and checkpoints; the web
  Clara inbox lists only unresolved exceptions.

## Known gaps

- The close gate checks that `tests_hash` is set; it does not re-hash the test
  files. The judge trusts the frozen hash recorded by the test agent.
- Workers run in the workspace directory. There is no separate worktree or
  branch per feature yet.
- The daemon commits the feature record with a system commit that carries the
  OpenCode co-author trailer, not a model trailer.

## Technical appendix

<details>
<summary>Paths, tools, and install mechanics</summary>

- Plugin: `plugins/clara`
- Ledger: `${CLARA_CONFIG_DIR:-${XDG_CONFIG_HOME:-~/.config}/clara}/ledger.db`
- Override: `CLARA_LEDGER_DB_PATH` or the plugin `db` option
- Home agent settings database: `~/.config/clara/clara.db` (separate)
- Management switch: `management.enabled` in the home agent database, owned by
  the panel and read by the plugin. Changing it also toggles `disabled` in the
  generated agent files and reloads OpenCode. Default off.
- Daemon: `plugins/clara/daemon.ts` ticks every 15s, reconciles `runs`, and
  launches one missing stage per tick through the OpenCode session API.
- Alert outbox: `alerts` in `ledger.db`, written by `collectAlerts` and read
  read-only by `apps/server/src/ledger`.
- Delivery state: `ledger_alert_state` and `ledger_alert_delivery` in the home
  agent database.
- Run state: `runs` (feature, stage, agent, session, status) and
  `daemon_lock` (one heartbeat row shared by every plugin instance).
- Stage agents: `001` spec, `002` test, `003` build, `004` docs, `judge` close.
- Daemon options: `daemon`, `daemonIntervalMs`, `daemonLockStaleMs`,
  `daemonMaxSpawnsPerTick`, `daemonModel`; `CLARA_DAEMON=0` disables it.
  Without `daemonModel`, a worker inherits the latest session model in the
  workspace; if none exists, the daemon opens a decision instead of guessing.
- Migrations: `plugins/clara/migrations`
- Agents: `plugins/clara/agents.json`, rendered to
  `~/.config/opencode/agents/*.md`
- Plugin link: `~/.config/opencode/plugins/clara`
- Tools: `clara_submit`, `clara_inbox`, `clara_ask`, `clara_approve`,
  `clara_criteria`, `clara_freeze`, `clara_checkpoint`, `clara_event`,
  `clara_decide`, `clara_gate`, `clara_resolve`, `clara_tick`
- `clara_ask` reports the frozen hash, the docs stage, the latest runs, the
  human-gate status, and an event summary, so the judge never needs the
  filesystem or a shell.
- Feature records: `docs/records/NNN-slug.md`, append-only and intentionally
  outside the canonical docs index. The daemon commits one when a feature
  closes.
- CLI: `pnpm clara:ledger list` and
  `pnpm clara:ledger run <tool> [json] [--agent <id>] [--db <path>]`. It calls
  the same tool definitions against the same ledger and still derives the actor
  from the agent id.
- OpenCode 2.2.5 discovers agents only from markdown or an `agents` config map,
  not from plugin code. The installer renders `agents.json`, and the home agent
  keeps the generated files' `disabled` field in sync with management.
- See [plugins/clara/README.md](../../plugins/clara/README.md) for the full tool
  reference and state machine.

</details>
