# Clara ledger plugin

The ledger is one OpenCode plugin, one SQLite file, and the tools the Clara
agents call. There is no CLI and no long-running process here yet — this is the
state layer everything else will sit on.

The rule the whole thing is built around: **state crosses agent boundaries,
sessions do not.** Nothing in here reads or reconstructs a conversation. If the
ledger cannot answer a question, it records a schema gap instead of guessing.

## Files

| File               | What it is                                                       |
| ------------------ | ---------------------------------------------------------------- |
| `index.ts`         | Plugin entry. Registers the `clara_*` tools.                     |
| `db.ts`            | SQLite driver selection, WAL, migration runner, path resolution. |
| `queries.ts`       | Every ledger operation. Deterministic — no model calls.          |
| `selftest.ts`      | End-to-end check against a throwaway DB.                         |
| `agents.json`      | The six Clara agents, in OpenCode agent-config shape.            |
| `migrations/*.sql` | Schema, applied in filename order.                               |

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
server. The ledger opens with `journal_mode=WAL` and `foreign_keys=ON`, then
applies any migration not yet recorded in `schema_migrations`.

On load the plugin prints:

```text
[clara] ledger ready at /home/you/.config/clara/ledger.db
```

Tool ids are namespaced: `clara_submit`, `clara_inbox`, and so on.

## The tools

### Human-facing

| Tool            | Purpose                                                                                                                          |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `clara_submit`  | Register a feature. Writes the ledger row, the `docs/features/NNN-slug.md` record, and the first event. Starts in `spec`.        |
| `clara_inbox`   | Everything that needs a human: open decisions, stalled features, features over soft budget. Empty output when nothing needs you. |
| `clara_ask`     | Read state for one feature, one workspace, or all. Facts only. If the ledger can't answer, it records a schema gap.              |
| `clara_approve` | Record human approval of the proposed criteria. `spec → planned`.                                                                |
| `clara_resolve` | Close an open decision by id.                                                                                                    |

### Spec agent (`ai_1`)

| Tool             | Purpose                                                                      |
| ---------------- | ---------------------------------------------------------------------------- |
| `clara_criteria` | Propose acceptance criteria. Each needs a `test_path` or `human_gate: true`. |

### Test agent (`ai_2`)

| Tool           | Purpose                                                           |
| -------------- | ----------------------------------------------------------------- |
| `clara_freeze` | Record the test-suite hash. After this, the tests may not change. |

### Build agent (`ai_3`)

| Tool               | Purpose                                                                |
| ------------------ | ---------------------------------------------------------------------- |
| `clara_checkpoint` | Report tests passed/total, files changed, blockers, next step, tokens. |

### Supervisor (`ai_0`)

| Tool           | Purpose                                                       |
| -------------- | ------------------------------------------------------------- |
| `clara_event`  | Append an event and optionally transition state.              |
| `clara_decide` | Open a decision packet. It stays in the inbox until resolved. |
| `clara_tick`   | Run the deterministic rules once. Dry run by default.         |

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
  `003`→`ai_3`, `judge`→`ai_0`, `clara`→`human`), not from the arguments.
  An implementer cannot pass `actor: "ai_0"`.
- Only `ai_0` may move a feature to `done` or `scrapped`. An implementer can
  request `review`, never close its own work.
- `clara_approve` and `clara_resolve` are human-only.
- `clara_criteria` is `ai_1`/human; `clara_freeze` is `ai_2`/human;
  `clara_checkpoint` is `ai_3`/human; `clara_decide` and `clara_tick` are
  `ai_0`/human.
- Criteria can only be proposed in `spec` and approved in `spec`.
- Tests freeze only in `planned`.
- Checkpoints only exist in `building`.

## Gates

- **Nothing builds before approval.** `submit` leaves the feature in `spec`;
  `approve` is the only path to `planned`.
- **Tests are frozen.** `freeze` records a hash; the close gate compares
  against it.
- **Silence is not approval.** Every decision carries
  `default_if_silent`, defaulting to `block`.
- **No model in the loop for state.** `tick` is pure SQL and comparisons.

## `tick`

`clara_tick` defaults to `dry_run: true` and reports what it _would_ do.
Pass `false` to apply. Checks, per active feature:

1. over hard budget → kill (`budget`)
2. more than 3 failed attempts → kill (`attempts`)
3. past the wall clock → kill (`time`)
4. no event for 10 minutes while `building` → mark stalled
5. over soft budget → open one decision (never one per tick)
6. three flat checkpoints with rising spend → open one decision

Kills only happen for hard budget, attempts, and wall clock. Soft budget
always asks first.

## Feature records

Each feature gets `<workspace>/docs/features/NNN-slug.md`. The ledger owns
the row; the record is prose for humans and is append-only. If the workspace
path does not exist, the record is skipped and `submit` says so.

## Self-test

```sh
pnpm --filter @clara/opencode-plugin test
```

It creates a temp DB and workspace, registers the plugin through a mock
editor to confirm all 11 tools wire up, then walks a feature from `submit`
through approval, freeze, build, review, close, plus the failure paths
(no unbacked criteria, illegal transitions, implementer closing, dry-run vs
live tick). Expect `60/60 checks passed`.

## Not built yet

- The daemon/scheduler that spawns work. `tick` is the deterministic half
  and is callable today; nothing calls it on a timer.
- A HUB guard and lock. A global plugin loads once per location, so when the
  scheduler lands only one process may tick.
- `ctx.session` spawning of the worker agents.
- Wiring `judge.md` as the `ai_0` judgment subagent.
