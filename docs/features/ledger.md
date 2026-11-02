# Ledger

## Summary

The Clara ledger is an OpenCode plugin that records feature state, acceptance
criteria, decisions, checkpoints, and events in one SQLite database. It gives
the Clara agents a shared source of truth without passing session history
between them.

## User flow

1. Run `pnpm clara:plugin:install` from the Clara repository.
2. Reload OpenCode. The `clara`, `001`–`004`, and `judge` agents appear.
3. Select the `clara` agent and submit a feature with `clara_submit`.
4. Ask for status at any time with `clara_ask` or `clara_inbox`.
5. Approve the proposed criteria with `clara_approve`; nothing builds before
   that.
6. The spec, test, and build workers use their own tools to propose criteria,
   freeze tests, and record checkpoints.
7. Resolve any open decision with `clara_resolve`.

## Core business rules

1. **State crosses agent boundaries; sessions do not.** Every status answer
   comes from the ledger, never from a reconstructed conversation.
2. **Silence is never approval.** A decision defaults to `block` when nobody
   answers.
3. **Only the supervisor closes work.** An implementer can request `review`;
   only `ai_0` can move a feature to `done` or `scrapped`.
4. **Tests are frozen.** The test agent records a hash, and the close gate
   compares against it.
5. **The ledger is deterministic.** `clara_tick` is pure SQL and comparisons;
   it makes no model calls.

## Edge cases

- If the ledger cannot answer a question, it records a schema gap instead of
  guessing.
- If a workspace path does not exist, `clara_submit` skips the feature record
  and says so.
- The actor is derived from the calling agent, so an implementer cannot spoof
  `ai_0`.
- Illegal state transitions are rejected.
- A killed feature records a reason code; terminal states cannot reopen.
- The plugin falls back from `node:sqlite` to `bun:sqlite` at runtime.
- Migrations apply in filename order and are recorded in `schema_migrations`.
- The previous scratch ledger is not reused; a fresh database is created on
  first load at the new path.

## Out of scope

- The daemon or scheduler that ticks rules and spawns workers
- Worker session spawning, worktree creation, and judge invocation
- Cost rollups for accepted features
- Scrap-reason classification for `spec`, `context`, `model`, and `taste`
- A web or panel view of the ledger

## Technical appendix

<details>
<summary>Paths, tools, and install mechanics</summary>

- Plugin: `plugins/clara`
- Ledger: `${CLARA_CONFIG_DIR:-${XDG_CONFIG_HOME:-~/.config}/clara}/ledger.db`
- Override: `CLARA_LEDGER_DB_PATH` or the plugin `db` option
- Home agent settings database: `~/.config/clara/clara.db` (separate)
- Migrations: `plugins/clara/migrations`
- Agents: `plugins/clara/agents.json`, rendered to
  `~/.config/opencode/agents/*.md`
- Plugin link: `~/.config/opencode/plugins/clara`
- Tools: `clara_submit`, `clara_inbox`, `clara_ask`, `clara_approve`,
  `clara_criteria`, `clara_freeze`, `clara_checkpoint`, `clara_event`,
  `clara_decide`, `clara_resolve`, `clara_tick`
- CLI: `pnpm clara:ledger list` and
  `pnpm clara:ledger run <tool> [json] [--agent <id>] [--db <path>]`. It calls
  the same tool definitions against the same ledger and still derives the actor
  from the agent id.
- OpenCode 2.2.5 discovers agents only from markdown or an `agents` config map,
  not from plugin code. The installer renders `agents.json` for that reason.
- See [plugins/clara/README.md](../../plugins/clara/README.md) for the full tool
  reference and state machine.

</details>
