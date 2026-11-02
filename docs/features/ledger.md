# Ledger

## Summary

The Clara ledger is an OpenCode plugin that records feature state, acceptance
criteria, decisions, checkpoints, and events in one SQLite database. It gives
the Clara agents a shared source of truth without passing session history
between them. A daemon turns that state into work by launching the spec, test,
build, docs, and judge agents in child sessions.

## User flow

1. Run `pnpm clara:plugin:install` from the Clara repository.
2. Reload OpenCode. The `clara`, `001`–`004`, and `judge` agents appear.
3. Select the `clara` agent and submit a feature with `clara_submit`.
4. Ask for status at any time with `clara_ask` or `clara_inbox`.
5. Approve the proposed criteria with `clara_approve`; nothing builds before
   that.
6. The daemon launches the spec agent to propose criteria; after approval it
   launches the test, build, docs, and judge agents as each stage completes.
7. At `review`, the person verifies the human-gate criteria with `clara_gate`;
   the daemon launches the docs agent when there is a docs impact, then the
   judge. The judge closes only when every gate is recorded.
8. Resolve any open decision with `clara_resolve`. Only `ai_0` can mark a
   feature done.

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
- The plugin falls back from `node:sqlite` to `bun:sqlite` at runtime.
- Migrations apply in filename order and are recorded in `schema_migrations`.
- The previous scratch ledger is not reused; a fresh database is created on
  first load at the new path.

## Out of scope

- Worktree and branch creation; workers run in the workspace directory
- Automatic approval or resolution; the human gates stay human
- Cost rollups for accepted features
- Scrap-reason classification for `spec`, `context`, `model`, and `taste`
- A web or panel view of the ledger

## Known gaps

- The close gate checks that `tests_hash` is set; it does not re-hash the test
  files. The judge trusts the frozen hash recorded by the test agent.
- Workers run in the workspace directory. There is no separate worktree or
  branch per feature yet.

## Technical appendix

<details>
<summary>Paths, tools, and install mechanics</summary>

- Plugin: `plugins/clara`
- Ledger: `${CLARA_CONFIG_DIR:-${XDG_CONFIG_HOME:-~/.config}/clara}/ledger.db`
- Override: `CLARA_LEDGER_DB_PATH` or the plugin `db` option
- Home agent settings database: `~/.config/clara/clara.db` (separate)
- Daemon: `plugins/clara/daemon.ts` ticks every 15s, reconciles `runs`, and
  launches one missing stage per tick through the OpenCode session API.
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
- CLI: `pnpm clara:ledger list` and
  `pnpm clara:ledger run <tool> [json] [--agent <id>] [--db <path>]`. It calls
  the same tool definitions against the same ledger and still derives the actor
  from the agent id.
- OpenCode 2.2.5 discovers agents only from markdown or an `agents` config map,
  not from plugin code. The installer renders `agents.json` for that reason.
- See [plugins/clara/README.md](../../plugins/clara/README.md) for the full tool
  reference and state machine.

</details>
