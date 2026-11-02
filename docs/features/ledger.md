# Ledger

## Summary

The Clara ledger is an OpenCode plugin that records feature state, acceptance
criteria, decisions, checkpoints, and events in one SQLite database. It gives
the Clara agents a shared source of truth without passing session history
between them. A daemon turns that state into work by launching the spec, test,
build, docs, and judge agents in child sessions, and turns exceptions into
Clara conversations in the session that owns the feature.

## User flow

1. Run `pnpm clara:plugin:install` from the Clara repository.
2. Enable **Clara management** in the agent panel. Turning it on is the master
   switch for the ledger daemon, exception sessions, and the Clara agents in
   OpenCode.
3. The `clara`, `001`–`004`, and `judge` agents appear while the switch is on.
   The home agent rewrites their generated files and reloads OpenCode whenever
   the switch changes, so no reinstall is needed.
4. Select the `clara` agent and submit a feature with `clara_submit`.
5. Ask for status at any time with `clara_ask` or `clara_inbox`.
6. Approve the proposed criteria with `clara_approve`; nothing builds before
   that. The feature remembers the session where it was submitted.
7. The daemon launches the spec agent to propose criteria; after approval it
   launches the test, build, docs, and judge agents as each stage completes.
   Every worker session is created with `initiatedBy: "daemon"` and
   `automation: true` metadata, and its initial handoff prompt carries
   `source: "daemon"` and `synthetic: true`. Clients use those markers to keep
   worker sessions and daemon input out of the human mailbox and transcript
   attribution.
8. At `review`, the person verifies the human-gate criteria with `clara_gate`;
   the daemon launches the docs agent when there is a docs impact, then the
   judge. The judge closes only when every gate is recorded.
9. Resolve any open decision with `clara_resolve`. Only `ai_0` can mark a
   feature done.
10. When a decision, approval, gate, stall, budget, or kill needs a person, the
    daemon returns to the Clara session that owns the feature and asks there.
    The existing session inbox and notifications carry the alert; there is no
    separate ledger inbox.

## Feature boundary

Clara management is experimental and is isolated from ordinary session
management in three layers:

1. **Build inclusion.** `CLARA_MANAGEMENT` (server) and
   `VITE_CLARA_MANAGEMENT` (web and panel) exclude the feature when set to `0`,
   `false`, or `off`. The repository scripts default both to `1`, so a normal
   `pnpm build` or `pnpm dev` includes Clara management; override with
   `CLARA_MANAGEMENT=0 VITE_CLARA_MANAGEMENT=0 pnpm build` (or set just the
   side you want to exclude). An excluded build does not load the ledger
   modules and does not show the panel switch.
2. **Runtime switch.** `management.enabled` is the master switch described
   below. It defaults off. When off, the plugin does not open the ledger or
   register tools, the daemon is not constructed, and no exception sessions are
   opened.
3. **Uninstall.** `pnpm clara:plugin:uninstall` removes the plugin link and the
   generated agent files. Add `--purge` to remove the ledger database, the
   legacy delivery sidecar, the management setting, and the legacy delivery
   tables from the agent database. Stop the home agent first so its settings
   database is not locked.

A feature stores the Clara session where the human submitted it. Every later
exception for that feature is prompted into the same session. If the session is
missing, archived, or not a Clara session, the daemon creates one and writes it
back to the feature. The `alerts` table stays as the deterministic outbox and
delivery record; the old cursor sidecar is only a legacy uninstall target.

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
   the daemon, the tools, exception sessions, and the Clara agent catalog. When
   it is off, the plugin registers no tools and starts no daemon, and ordinary
   OpenCode session alerts continue unchanged.
9. **The ledger records exceptions; the daemon turns them into conversations.**
   The plugin writes the `alerts` outbox and prompts the feature's Clara
   session with a synthetic, queued handoff. The notification is the standard
   session alert: a form means Needs Input, while an information message means
   Ready for Review.
10. **Worker identity is explicit, not inferred from a title.** The daemon
    writes `automation: true` on worker sessions and `synthetic: true` on their
    handoff prompts. Exception sessions are the opposite: they have no
    automation flag, so they stay in the human inbox and raise their own
    alerts. Their handoff is still `source: "daemon"` and `synthetic: true`.
    The title prefix stays only as a compatibility fallback for older worker
    sessions.

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
- Clara management is disabled; the plugin registers no tools, stays loaded
  without opening the ledger, and starts no daemon. The home agent marks the
  generated agent files disabled at startup and on every switch change, then
  reloads OpenCode so the agents leave the catalog. Agent files edited after
  installation are reported and left untouched.
- The home agent database is missing; management defaults to off.
- An alert is delivered once even across an agent restart; the alert row keeps
  the session and delivery time.
- The feature's session is missing, archived, a worker, or not a Clara session;
  the daemon creates a new one and writes it back to the feature.
- The linked session is snoozed; the prompt still arrives, but the user's snooze
  keeps its notifications quiet.
- No model or workspace path is available for a replacement session; the alert
  stays undelivered and the next tick retries.
- A form is skipped or times out; Clara does not act, and the ledger exception
  stays open.
- The alert resolves while Clara is composing; `clara_attention` refuses the
  form and Clara stops.
- A gate is rejected after it was verified; the reopened alert clears its
  delivery marker so the exception reaches the session again.
- A feature closes but its record is missing; the daemon leaves it uncommitted
  instead of inventing a file.
- The plugin falls back from `node:sqlite` to `bun:sqlite` at runtime.
- Migrations apply in filename order and are recorded in `schema_migrations`.
- The previous scratch ledger is not reused; a fresh database is created on
  first load at the new path.

## Attention states

`clara_attention` presents an exception in one of four states:

| State      | Presentation                                           | Session state    |
| ---------- | ------------------------------------------------------ | ---------------- |
| `feedback` | a form with one text field for an open answer          | Needs Input      |
| `form`     | a standard form with the supplied structured fields    | Needs Input      |
| `confirm`  | a standard form with one boolean field, e.g. “Start”   | Needs Input      |
| `info`     | a normal Clara message; no form and no answer required | Ready for Review |

The form is also the stale check. If the alert resolved while Clara was
composing, the tool refuses to post it and Clara stops.

## Out of scope

- Worktree and branch creation; workers run in the workspace directory
- Automatic approval or resolution; the human gates stay human
- Cost rollups for accepted features
- Scrap-reason classification for `spec`, `context`, `model`, and `taste`
- A general web or panel view of features, criteria, and checkpoints; open
  exceptions are read with `clara_inbox` or raised in a Clara session.

## Known gaps

- The close gate checks that `tests_hash` is set; it does not re-hash the test
  files. The judge trusts the frozen hash recorded by the test agent.
- Workers run in the workspace directory. There is no separate worktree or
  branch per feature yet.
- The daemon commits the feature record with a system commit that carries the
  OpenCode co-author trailer, not a model trailer.
- `clara_attention` uses the session form API when the plugin exposes it. If
  the host does not, Clara falls back to a prose question and the standard
  composer; the four attention states still record, but the form is absent.
- A confirmation is a boolean field plus the form's Submit control, not a
  single-click action.

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
- Build inclusion: `CLARA_MANAGEMENT` (server) and `VITE_CLARA_MANAGEMENT` (web
  and panel) exclude the feature when set to `0`, `false`, or `off`. An
  excluded build does not load the server facade or the web session policy.
- Uninstall: `pnpm clara:plugin:uninstall` removes the plugin link and generated
  agents; `--purge` also removes the ledger, the legacy delivery sidecar, the
  management setting, and legacy delivery tables.
- Daemon: `plugins/clara/daemon.ts` ticks every 15s, reconciles `runs`, and
  launches one missing stage per tick through the OpenCode session API. It
  exports `DAEMON_SESSION_METADATA` (`initiatedBy: daemon`, `automation: true`)
  and `DAEMON_PROMPT_METADATA` (`source: daemon`, `synthetic: true`) and passes
  them to `session.create` and the initial `session.prompt`.
- Attention delivery: `plugins/clara/attention.ts` selects undelivered rows from
  `alerts`, resolves the feature's session, creates one only when needed with
  `initiatedBy: clara` / `ledgerAlert: true`, and prompts it with
  `source: daemon` / `synthetic: true` and `delivery: queue`. The prompt names
  `clara_attention` and the alert key.
- Session links: `features.session_id` and `workspaces.session_id` point at the
  conversation that owns the feature. `alerts.session_id` and `notified_at`
  record delivery; `attention_state` records the last presentation Clara chose.
- Alert outbox: `alerts` in `ledger.db`, written by `collectAlerts` and consumed
  by `deliverAttention` on the daemon's next tick.
- Legacy delivery state: `~/.config/clara/ledger-alerts.db` is no longer used.
  `--purge` still removes it for upgrades.
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
- Tools: `clara_submit`, `clara_attention`, `clara_inbox`, `clara_ask`,
  `clara_approve`, `clara_criteria`, `clara_freeze`, `clara_checkpoint`,
  `clara_event`, `clara_decide`, `clara_gate`, `clara_resolve`, `clara_tick`
- `clara_attention` presents one alert with a standard form (`feedback`,
  `form`, or `confirm`) or a plain information message (`info`). It refuses an
  alert that already resolved and records the answer as an `attention.*` event.
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
