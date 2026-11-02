# Clara ledger plugin

The ledger is one OpenCode plugin, one SQLite file, and the tools the Clara
agents call. A small [CLI](#cli) invokes the same tools directly so you can test
a call without an agent. The daemon turns ledger state into worker sessions, and
the home agent reads the alert outbox and delivers exceptions to every client.

The rule the whole thing is built around: **state crosses agent boundaries,
sessions do not.** Nothing in here reads or reconstructs a conversation. If the
ledger cannot answer a question, it records a schema gap instead of guessing.

## Files

| File               | What it is                                                         |
| ------------------ | ------------------------------------------------------------------ |
| `index.ts`         | Plugin entry. Registers the `clara_*` tools and starts the daemon. |
| `db.ts`            | SQLite driver selection, WAL, migration runner, path resolution.   |
| `queries.ts`       | Every ledger operation. Deterministic — no model calls.            |
| `daemon.ts`        | Scheduler: reconciles worker sessions and launches the next stage. |
| `runs.ts`          | Run tracking and the single-writer lock.                           |
| `selftest.ts`      | End-to-end check against a throwaway DB.                           |
| `cli.ts`           | Run one tool directly against the ledger, without an agent.        |
| `agents.json`      | The six Clara agents, in OpenCode agent-config shape.              |
| `migrations/*.sql` | Schema, applied in filename order.                                 |

## Install

From the Clara repository:

```sh
pnpm clara:plugin:install
opencode reload
```

The installer:

1. creates `~/.config/clara` and `~/.config/opencode/plugins`,
2. symlinks `~/.config/opencode/plugins/clara` to this directory,
3. renders `agents.json` into `~/.config/opencode/agents/*.md`.

The installer reads `management.enabled` from the home agent database and uses
it for the first render. After installation the home agent keeps the agents in
sync: at startup and whenever the switch changes it rewrites `disabled: true`
in the generated files and reloads OpenCode, so no reinstall is needed. Files
edited after installation are left untouched; re-run with `--force` to replace
them.

OpenCode discovers global plugins in `~/.config/opencode/plugins/`. A local
plugin directory needs a `package.json` with a `name` and `exports`; this one
exports `index.ts`.

`--force` replaces an existing non-symlink plugin directory and overwrites
agent files that were edited after installation.

OpenCode 2.2.5 cannot register new agents from plugin code. Agents are
discovered only from markdown under a config root or from the `agents` map in an
`opencode.json(c)`. `agents.json` is the source of truth here, and the installer
materializes it where OpenCode looks.

## Storage

```text
~/.config/clara/ledger.db
```

Resolution order:

1. plugin option `db`
2. `CLARA_LEDGER_DB_PATH`
3. `${CLARA_CONFIG_DIR:-${XDG_CONFIG_HOME:-~/.config}/clara}/ledger.db`

The home agent's settings database is a different file:

```text
~/.config/clara/clara.db
```

Do not point `CLARA_DB` or `CLARA_DB_PATH` at the ledger. Those belong to the
server. The ledger opens with `journal_mode=WAL`, `foreign_keys=ON`, and
`busy_timeout=5000`, then applies any migration not yet recorded in
`schema_migrations`.

On load the plugin prints:

```text
[clara] ledger ready at /home/you/.config/clara/ledger.db
[clara] management enabled
[clara] daemon started (every 15s)
```

The plugin reads `management.enabled` from the home agent database
(`~/.config/clara/clara.db`) without writing it. When the flag is off, the
plugin does not open the ledger, registers no `clara_*` tools, and starts no
daemon. The panel keeps the generated agents marked `disabled`. The CLI
bypasses this guard for manual recovery.

Remove the plugin with `pnpm clara:plugin:uninstall`. Add `--purge` to remove
the ledger database, the alert delivery sidecar, the management setting, and
the legacy delivery tables from the agent database.

The daemon does not start when the host has no session API, or when it is
disabled with `daemon: false` or `CLARA_DAEMON=0`.

Tool ids are namespaced: `clara_submit`, `clara_inbox`, and so on. OpenCode
derives the id from each tool's `options.namespace`; the
`editor.namespace({ name: 'clara' })` call only describes the group. Every tool
must set `options: { namespace: 'clara' }`, or its id stays bare (`submit`) and
the `clara_*` permissions in `agents.json` will not match it.

## The tools

### Human-facing

| Tool            | Purpose                                                                                                                          |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `clara_submit`  | Register a feature. Writes the ledger row, the `docs/records/NNN-slug.md` record, and the first event. Starts in `spec`.         |
| `clara_inbox`   | Everything that needs a human: open decisions, stalled features, features over soft budget. Empty output when nothing needs you. |
| `clara_ask`     | Read state for one feature, one workspace, or all. Facts only. If the ledger can't answer, it records a schema gap.              |
| `clara_approve` | Record human approval of the proposed criteria. `spec → planned`.                                                                |
| `clara_gate`    | Record the human's verification of the human-gate criteria in `review`. The judge closes only when every gate is recorded.       |
| `clara_resolve` | Close an open decision by id.                                                                                                    |

### Spec agent (`ai_1`)

| Tool             | Purpose                                                                                                  |
| ---------------- | -------------------------------------------------------------------------------------------------------- |
| `clara_criteria` | Propose acceptance criteria. Each needs a `test_path` or `human_gate: true`; also records `docs_impact`. |

### Test agent (`ai_2`)

| Tool           | Purpose                                                           |
| -------------- | ----------------------------------------------------------------- |
| `clara_freeze` | Record the test-suite hash. After this, the tests may not change. |

### Build agent (`ai_3`)

| Tool               | Purpose                                                                                             |
| ------------------ | --------------------------------------------------------------------------------------------------- |
| `clara_checkpoint` | Report tests passed/total, files changed, blockers, next step, tokens, and a refined `docs_impact`. |

### Supervisor (`ai_0`)

| Tool           | Purpose                                                       |
| -------------- | ------------------------------------------------------------- |
| `clara_event`  | Append an event and optionally transition state.              |
| `clara_decide` | Open a decision packet. It stays in the inbox until resolved. |
| `clara_tick`   | Run the deterministic rules once. Dry run by default.         |

## CLI

The CLI calls the same tool definitions against the same ledger, without
starting OpenCode. Role checks still apply: `--agent` decides who is acting,
and the actor is derived exactly as it is inside a session.

```sh
pnpm clara:ledger list
pnpm clara:ledger run clara_inbox
pnpm clara:ledger run clara_ask '{"question":"what is in flight?"}'
pnpm clara:ledger run clara_tick '{"dry_run":true}' --agent judge
```

`run` takes a tool id (with or without the `clara_` prefix), an optional JSON
argument, and these options:

| Option         | Meaning                                                                         |
| -------------- | ------------------------------------------------------------------------------- |
| `--agent <id>` | `clara` (default), `001`–`004`, `judge`, or any other agent id.                 |
| `--db <path>`  | Ledger path. Defaults to `CLARA_LEDGER_DB_PATH` or `~/.config/clara/ledger.db`. |
| `--json`       | Print the whole `{ content }` result instead of only `content`.                 |

The JSON argument can be inline, `-` for stdin, or `@path` to read a file. The
actor and ledger path are printed to stderr; only the tool's content goes to
stdout, so `> result.txt` captures just the result.

```sh
echo '{"question":"what is in flight?"}' | pnpm clara:ledger run clara_ask -
pnpm clara:ledger run clara_submit @spec.json --agent clara
```

## State machine

```text
spec ──approve──▶ planned ──build──▶ building ──close──▶ review ──confirm──▶ done
  │                  │                  │                  │
  └──────────────────┴──────────────────┴──────────────────┴──▶ scrapped
```

Legal transitions are enforced in `appendEvent`:

| From       | To                             |
| ---------- | ------------------------------ |
| `spec`     | `planned`, `scrapped`          |
| `planned`  | `building`, `scrapped`         |
| `building` | `review`, `scrapped`           |
| `review`   | `done`, `building`, `scrapped` |
| `done`     | —                              |
| `scrapped` | —                              |

Actor rules:

- The actor is derived from the calling agent (`001`→`ai_1`, `002`→`ai_2`,
  `003`→`ai_3`, `004`→`ai_4`, `judge`→`ai_0`, `clara`→`human`), not from the
  arguments. An implementer cannot pass `actor: "ai_0"`.
- Only `ai_0` may move a feature to `done` or `scrapped`. An implementer can
  request `review`, never close its own work.
- `clara_approve`, `clara_gate`, and `clara_resolve` are human-only.
- `clara_criteria` is `ai_1`/human; `clara_freeze` is `ai_2`/human;
  `clara_checkpoint` is `ai_3`/human; `clara_decide` is `ai_0`/`ai_4`/human;
  `clara_tick` is `ai_0`/human.
- Criteria can only be proposed in `spec` and approved in `spec`.
- Tests freeze only in `planned`.
- Checkpoints only exist in `building`.

## Gates

- **Nothing builds before approval.** `submit` leaves the feature in `spec`;
  `approve` is the only path to `planned`.
- **Tests are frozen.** `freeze` records a hash; the close gate requires it.
  The daemon does not re-hash the files yet.
- **Human gates are recorded.** `clara_gate` records the human's verification
  of each `human_gate: true` criterion. The judge cannot verify them and closes
  only when every gate is recorded.
- **Silence is not approval.** Every decision carries
  `default_if_silent`, defaulting to `block`.
- **No model in the loop for state.** `tick` is pure SQL and comparisons.
- **One daemon.** A lock row keeps multiple plugin instances from spawning
  duplicate workers.
- **No duplicate stage.** A live session in `runs` blocks a second launch of
  the same stage.

## Daemon

The plugin starts a daemon when OpenCode loads it. The daemon owns the loop;
the `clara` agent only submits, asks, approves, and resolves. It ticks every
15 seconds by default:

1. reconcile the sessions recorded in `runs`;
2. run `clara_tick` with `dry_run: false`;
3. launch at most one missing stage.

| Ledger state               | Stage                           | Agent   |
| -------------------------- | ------------------------------- | ------- |
| `spec`, no criteria        | propose criteria                | `001`   |
| `spec`, criteria proposed  | wait for `clara_approve`        | —       |
| `planned`, no `tests_hash` | write and freeze tests          | `002`   |
| `planned`, tests frozen    | move to `building`              | `003`   |
| `building`                 | implement and request `review`  | `003`   |
| `review`, docs impact      | apply docs                      | `004`   |
| `review`                   | close, or ask for missing gates | `judge` |

Each stage runs in a child session in the feature's workspace. Its id and
status live in `runs`. A stage with a live run is never launched twice. If a
session ends without advancing the ledger, the daemon opens a decision and
waits; it retries that stage only after the human resolves the decision.

`daemon_lock` has one row. An instance must own it to tick, so several OpenCode
locations can load the plugin without spawning duplicate workers. A heartbeat
older than five minutes can be taken over after a crash.

Options on the plugin entry:

| Option                   | Default  | Meaning                                               |
| ------------------------ | -------- | ----------------------------------------------------- |
| `daemon`                 | `true`   | Start the scheduler.                                  |
| `daemonIntervalMs`       | `15000`  | Milliseconds between ticks.                           |
| `daemonLockStaleMs`      | `300000` | Heartbeat age before another instance may take over.  |
| `daemonMaxSpawnsPerTick` | `1`      | Upper bound on new worker sessions per tick.          |
| `daemonModel`            | unset    | `provider/model` or `{ providerID, id }` for workers. |

If no model can be resolved, the daemon opens a decision instead of launching a
worker. Without `daemonModel`, it uses the latest session model in the
workspace. Set `daemon: false` or `CLARA_DAEMON=0` to turn it off.

## `tick`

`clara_tick` defaults to `dry_run: true` and reports what it _would_ do.
Pass `false` to apply. The daemon calls the live form on every tick before it
launches a stage. Checks, per active feature:

1. over hard budget → kill (`budget`)
2. more than 3 failed attempts → kill (`attempts`)
3. past the wall clock → kill (`time`)
4. no event for 10 minutes while `building` → mark stalled
5. over soft budget → open one decision (never one per tick)
6. three flat checkpoints with rising spend → open one decision

Kills only happen for hard budget, attempts, and wall clock. Soft budget
always asks first.

## Feature records

Each feature gets `<workspace>/docs/records/NNN-slug.md`. The ledger owns the
row; the record is prose for humans and is append-only. If the workspace path
does not exist, the record is skipped and `submit` says so. Canonical docs stay
under `docs/features/**` and are the docs agent's only writable target.

The daemon commits a closed feature's record after the judge finishes, with an
explicit path and no unrelated staging.

## Self-test

```sh
pnpm --filter @clara/opencode-plugin test
```

It creates a temp DB and workspace, registers the plugin through a mock
editor to confirm all 12 tools wire up, then walks a feature from `submit`
through approval, freeze, build, review, close, plus the failure paths
(no unbacked criteria, illegal transitions, implementer closing, dry-run vs
live tick). It also drives a feature through the daemon with a mock session
API, checks the lock and retry path, and verifies that every tool is registered
as `clara_*` and that every explicit `clara_*` permission in `agents.json`
names a real tool. Expect `134/134 checks passed`.

## Alerts

`collectAlerts` writes one row per human-wait exception into `alerts`:
decisions, stalled features, over-budget work, criteria awaiting approval,
human gates awaiting verification, and recent hard kills. The home agent reads
that table read-only and delivers push, local notifications, and `ledger.alert`
states. The plugin never sends a notification itself.

The `clara_inbox` tool and the home agent's Clara inbox use the same set, so a
wait cannot appear in one and not the other.

## Not built yet

- Worktree and branch creation. Workers run in the workspace directory; the
  daemon does not create a separate checkout.
- Cost rollups for accepted features.
- Scrap-reason classification for `spec`, `context`, `model`, and `taste`.
- A panel view of the alert outbox; the panel shows ledger storage health and
  the Clara inbox lives in the web client.
