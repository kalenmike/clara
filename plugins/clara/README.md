# Clara ledger plugin

The ledger is one OpenCode plugin, one SQLite file, and the tools the Clara
agents call. A small [CLI](#cli) invokes the same tools directly so you can test
a call without an agent. The daemon turns ledger state into worker sessions and
turns exceptions into Clara conversations in the session that owns the request.

The rule the whole thing is built around: **state crosses agent boundaries,
sessions do not.** Nothing in here reads or reconstructs a conversation. If the
ledger cannot answer a question, it records a schema gap instead of guessing.

A **request** is the unit of work. A [pipeline](#pipelines) defines the stages
that turn a request into a result.

## Files

| File               | What it is                                                         |
| ------------------ | ------------------------------------------------------------------ |
| `index.ts`         | Plugin entry. Registers the `clara_*` tools and starts the daemon. |
| `db.ts`            | SQLite driver selection, WAL, migration runner, path resolution.   |
| `pipeline.ts`      | Pipeline types, validation, hashing, conditions, and templates.    |
| `queries.ts`       | Every ledger operation. Deterministic — no model calls.            |
| `daemon.ts`        | Scheduler: reconciles worker sessions and launches the next stage. |
| `runs.ts`          | Stage resolution, run tracking, and the single-writer lock.        |
| `attention.ts`     | Exception forms and delivery.                                      |
| `selftest.ts`      | End-to-end check against a throwaway DB.                           |
| `cli.ts`           | Run one tool or pipeline command directly, without an agent.       |
| `agents.json`      | The nine Clara agents, in OpenCode agent-config shape.             |
| `pipelines/*.json` | Reference copies of the software and content pipelines.            |
| `migrations/*.sql` | Schema, applied in filename order.                                 |

## Install

From the Clara repository:

```sh
pnpm clara plugin install
opencode reload
```

The installer:

1. creates `~/.local/share/clara` and `~/.config/opencode/plugins`,
2. symlinks `~/.config/opencode/plugins/clara` to this directory,
3. renders `agents.json` into `~/.config/opencode/agents/*.md`.

The installer reads `management.enabled` from the home agent database and uses
it for the first render. After installation the home agent keeps the agents in
sync: at startup and whenever the switch changes it rewrites `disabled: true`
in the generated files and reloads OpenCode, so no reinstall is needed. Files
edited after installation are left untouched; re-run with `--force` to replace
them.

The home agent only toggles files already in the manifest. Adding an agent to
`agents.json` therefore needs `pnpm clara plugin install` again; the sync alone
will not create it.

OpenCode discovers global plugins in `~/.config/opencode/plugins/`. A local
plugin directory needs a `package.json` with a `name` and `exports`; this one
exports `index.ts`.

## Storage

```text
~/.local/share/clara/ledger.db
~/.config/clara/pipelines/*.json
```

Resolution order for the ledger:

1. plugin option `db`
2. `CLARA_LEDGER_DB_PATH`
3. `${CLARA_DATA_DIR:-${XDG_DATA_HOME:-~/.local/share}/clara}/ledger.db`

The home agent's settings database is a different file:

```text
~/.local/share/clara/clara.db
```

Do not point `CLARA_DB` or `CLARA_DB_PATH` at the ledger. Those belong to the
server. The ledger opens with `journal_mode=WAL`, `foreign_keys=ON`, and
`busy_timeout=5000`, then applies any migration not yet recorded in
`schema_migrations`.

On load the plugin prints:

```text
[clara] ledger ready at /home/you/.local/share/clara/ledger.db
[clara] management enabled
[clara] daemon started (every 15s)
```

The plugin reads `management.enabled` from the home agent database
(`~/.local/share/clara/clara.db`) without writing it. When the flag is off, the
plugin does not open the ledger, registers no `clara_*` tools, and starts no
daemon. The panel keeps the generated agents marked `disabled`. The CLI
bypasses this guard for manual recovery.

Remove the plugin with `pnpm clara plugin uninstall`. Add `--purge` to remove
the ledger database, the legacy delivery sidecar, the management setting, and
the legacy delivery tables from the agent database.

The daemon does not start when the host has no session API, or when it is
disabled with `daemon: false` or `CLARA_DAEMON=0`.

Tool ids are namespaced: `clara_submit`, `clara_inbox`, and so on. OpenCode
derives the id from each tool's `options.namespace`; the
`editor.namespace({ name: 'clara' })` call only describes the group. Every tool
must set `options: { namespace: 'clara' }`, or its id stays bare (`submit`) and
the `clara_*` permissions in `agents.json` will not match it.

## Pipelines

A pipeline is a versioned JSON file:

```json
{
  "schemaVersion": 1,
  "id": "content",
  "name": "Content request",
  "version": 1,
  "stages": [
    {
      "id": "brief",
      "title": "Brief",
      "phase": "contract",
      "agent": "clara-brief",
      "role": "worker",
      "instructions": "Turn the request into a brief..."
    },
    {
      "id": "draft",
      "title": "Draft",
      "phase": "work",
      "agent": "clara-writer",
      "role": "worker",
      "instructions": "Write the draft...",
      "evidence": {
        "copy": { "type": "string", "required": true },
        "word_count": { "type": "number" }
      }
    },
    {
      "id": "deliver",
      "title": "Deliver",
      "phase": "close",
      "agent": "judge",
      "role": "closer",
      "instructions": "Deliver the copy and record the result.",
      "evidence": {
        "result": { "type": "string", "required": true },
        "artifacts": { "type": "array" }
      }
    }
  ]
}
```

Rules:

- Exactly one `contract` stage, first; exactly one `close` stage, last.
- `contract`, `work`, and `review` stages use `role: "worker"`; the close stage
  uses `role: "closer"`.
- `stages` are linear. `when` can skip a stage with one simple evidence
  condition. `gate` can require `clara_stage_gate` before or after a stage.
- Agents are existing OpenCode agents. Clara does not generate them.
- Files live under the user config directory, never in the workspace. A
  repository cannot define shell-capable agents.
- Each request pins `pipeline_id`, `pipeline_version`, `pipeline_hash`, and the
  full snapshot. Editing a file never changes an in-flight request.

Both examples are built-in presets, `software` and `content`, so `pipeline
select <workspace> content` works without copying a file. Reference copies live
in `pipelines/`; a file with the same id overrides the preset.

Shipped pipelines only name agents that ship in `agents.json`. `software` uses
`001`–`004` and the `judge` closer. `content` uses `clara-brief`, `clara-writer`,
and `clara-editor`, and shares the same `judge` closer. A user pipeline that
names an agent which is not installed is still valid, but the daemon opens a
blocked decision when that stage comes due, so check the agent names before
selecting a pipeline in a new workspace.

## The tools

### Human-facing

| Tool               | Purpose                                                                                                                   |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `clara_submit`     | Register a request. Writes the ledger row, the `docs/records/NNN-slug.md` record, and the first event. Starts in `draft`. |
| `clara_attention`  | Present one alert in this session. `info` needs no answer; `feedback`, `form`, and `confirm` post a standard form.        |
| `clara_inbox`      | Everything that needs a human: open decisions, stalled requests, over-budget work, approvals, stage gates, review gates.  |
| `clara_ask`        | Read state for one request, one workspace, or all. Facts only.                                                            |
| `clara_approve`    | Record human approval of the contract. `draft → approved`.                                                                |
| `clara_gate`       | Record the human verification of human-verification criteria in `review`.                                                 |
| `clara_stage_gate` | Record a human gate before or after a configured pipeline stage.                                                          |
| `clara_resolve`    | Close an open decision by id.                                                                                             |

### Stage agents

| Tool               | Purpose                                                                        |
| ------------------ | ------------------------------------------------------------------------------ |
| `clara_criteria`   | Propose the acceptance contract: automated, human, or artifact criteria.       |
| `clara_stage_done` | Complete the current stage with the evidence its pipeline definition requires. |
| `clara_progress`   | Record arbitrary stage metrics, a blocker, a next step, and tokens.            |

### Supervisor

| Tool           | Purpose                                                       |
| -------------- | ------------------------------------------------------------- |
| `clara_event`  | Append an event and optionally transition state.              |
| `clara_decide` | Open a decision packet. It stays in the inbox until resolved. |
| `clara_tick`   | Run the deterministic rules once. Dry run by default.         |

## CLI

The CLI calls the same tool definitions against the same ledger, without
starting OpenCode. Role checks still apply: `--agent` decides who is acting,
and the role is derived exactly as it is inside a session.

```sh
pnpm clara ledger list
pnpm clara ledger run clara_inbox
pnpm clara ledger run clara_ask '{"question":"what is in flight?"}'
pnpm clara ledger run clara_tick '{"dry_run":true}' --agent judge
```

`run` takes a tool id (with or without the `clara_` prefix), an optional JSON
argument, and these options:

| Option         | Meaning                                                                              |
| -------------- | ------------------------------------------------------------------------------------ |
| `--agent <id>` | `clara` (human), `001`–`004` (worker), `judge` (closer), or another agent id.        |
| `--db <path>`  | Ledger path. Defaults to `CLARA_LEDGER_DB_PATH` or `~/.local/share/clara/ledger.db`. |
| `--json`       | Print the whole `{ content }` result instead of only `content`.                      |

The JSON argument can be inline, `-` for stdin, or `@path` to read a file. The
actor and ledger path are printed to stderr; only the tool's content goes to
stdout, so `> result.txt` captures just the result.

The shipped workers are `001`–`004`, `clara-brief`, `clara-writer`, and
`clara-editor`; `judge` is the closer for both example pipelines.

Pipeline commands:

```sh
pnpm clara ledger pipeline list
pnpm clara ledger pipeline validate software
pnpm clara ledger pipeline validate ./my-pipeline.json
pnpm clara ledger pipeline select clara content --path /path/to/repo
pnpm clara ledger pipeline show clara
pnpm clara ledger pipeline show 42
```

## State machine

```text
draft ──approve──▶ approved ──work──▶ running ──review──▶ review ──close──▶ completed
  │                   │                  │                  │
  └───────────────────┴──────────────────┴──────────────────┴──▶ cancelled
```

Legal transitions are enforced in `appendEvent`:

| From        | To                                  |
| ----------- | ----------------------------------- |
| `draft`     | `approved`, `cancelled`             |
| `approved`  | `running`, `review`, `cancelled`    |
| `running`   | `review`, `cancelled`               |
| `review`    | `completed`, `running`, `cancelled` |
| `completed` | —                                   |
| `cancelled` | —                                   |

Role rules:

- The role comes from the live run behind the session, not from tool arguments.
  A custom pipeline agent gets the role its stage declares.
- An unknown agent with no live run has no write privileges.
- Only the closer role may complete or cancel a request.
- `clara_approve`, `clara_gate`, `clara_stage_gate`, and `clara_resolve` are
  human-only.
- `clara_criteria` is worker/human; `clara_stage_done` and `clara_progress` are
  worker/closer and must match the session's current stage.
- `clara_tick` is closer/human.

## Gates

- **Nothing runs before approval.** `submit` leaves the request in `draft`;
  `clara_approve` is the only path to `approved`.
- **Stages complete with evidence.** `clara_stage_done` validates required keys,
  types, and immutable values.
- **Human gates are recorded.** `clara_gate` records a human-verification
  criterion; `clara_stage_gate` records a pipeline stage gate.
- **Silence is not approval.** Every decision carries `default_if_silent`,
  defaulting to `block`.
- **No model in the loop for state.** `tick` is pure SQL and comparisons.
- **One daemon.** A lock row keeps multiple plugin instances from spawning
  duplicate workers.
- **No duplicate stage.** A live session in `runs` blocks a second launch of the
  same stage.

## Daemon

The plugin starts a daemon when OpenCode loads it. The daemon owns the loop; the
`clara` agent only submits, asks, approves, resolves, and gates. It ticks every
15 seconds by default:

1. reconcile the sessions recorded in `runs`;
2. run `clara_tick` with `dry_run: false`;
3. deliver alerts;
4. launch at most one missing stage from each request's pinned pipeline.

| Lifecycle state | What the daemon does                                  |
| --------------- | ----------------------------------------------------- |
| `draft`         | run the contract stage, then wait for `clara_approve` |
| `approved`      | run the first work stage and move to `running`        |
| `running`       | run remaining work stages, then move to `review`      |
| `review`        | run review stages, then the close stage               |
| `completed`     | commit the request record                             |

Each stage runs in a child session in the request's workspace. Its id, agent,
role, and status live in `runs`. A stage with a live run is never launched
twice. If a session ends without `clara_stage_done`, the daemon opens a decision
and waits; it retries that stage only after the human resolves the decision.

The worker session is created with `initiatedBy: "daemon"` and
`automation: true` metadata, and the initial handoff is sent with
`source: "daemon"` and `synthetic: true`. Clients use the automation marker to
keep workers out of the human mailbox and the synthetic marker to avoid
attributing the handoff to the person.

Exception sessions are the opposite. The daemon prompts the request's existing
Clara session with the same synthetic daemon marker and `delivery: "queue"`.
Only when that session is missing, archived, a worker, or not a Clara session
does it create one, with `initiatedBy: "clara"` and `ledgerAlert: true` but no
`automation` flag, then writes the new id back to `requests.session_id`.

`daemon_lock` has one row. An instance must own it to tick, so several OpenCode
locations can load the plugin without spawning duplicate workers. A heartbeat
older than five minutes can be taken over after a crash.

Options on the plugin entry:

| Option                   | Default  | Meaning                                                                               |
| ------------------------ | -------- | ------------------------------------------------------------------------------------- |
| `daemon`                 | `true`   | Start the scheduler.                                                                  |
| `daemonIntervalMs`       | `15000`  | Milliseconds between ticks.                                                           |
| `daemonLockStaleMs`      | `300000` | Heartbeat age before another instance may take over.                                  |
| `daemonMaxSpawnsPerTick` | `1`      | Upper bound on new worker sessions per tick.                                          |
| `daemonModel`            | unset    | `provider/model` or `{ providerID, id }` for workers and fallback exception sessions. |

If no model can be resolved, the daemon opens a decision instead of launching a
worker. Without `daemonModel`, it uses the latest session model in the
workspace. Set `daemon: false` or `CLARA_DAEMON=0` to turn it off.

## `tick`

`clara_tick` defaults to `dry_run: true` and reports what it _would_ do.
Pass `false` to apply. The daemon calls the live form on every tick before it
launches a stage. Checks, per active request:

1. over hard budget → cancel (`budget`)
2. more than 3 failed attempts → cancel (`attempts`)
3. past the wall clock → cancel (`time`)
4. a live worker with no event for 10 minutes → mark stalled
5. over soft budget → open one decision (never one per tick)
6. the pipeline's optional progress guard sees a flat metric with rising spend
   → open one decision

Cancellations only happen for hard budget, attempts, and wall clock. Soft budget
always asks first.

## Request records

Each request gets `<workspace>/docs/records/NNN-slug.md`. The ledger owns the
row; the record is prose for humans and is append-only. If the workspace path
does not exist, the record is skipped and `submit` says so. Canonical docs stay
under `docs/features/**` and are the docs stage's only writable target.

The daemon commits a closed request's record after the closer finishes, with an
explicit path and no unrelated staging.

## Self-test

```sh
pnpm --filter @clara/opencode-plugin test
```

It creates a temp DB and workspace, registers the plugin through a mock editor
to confirm all 14 tools wire up, then walks the software pipeline from `submit`
through approval, evidence, progress, review, close, plus the failure paths
(no unbacked criteria, illegal transitions, implementer closing, dry-run vs
live tick). It also drives a request through the daemon with a mock session API,
checks the lock and retry path, and verifies that every tool is registered as
`clara_*`, that every explicit `clara_*` permission in `agents.json` names a
real tool, and that every shipped pipeline names an agent defined there. It also
drives a non-software content pipeline end to end, including
an optional stage gate, and exercises the attention tool and delivery loop
against mock session and form APIs.

## Alerts

`collectAlerts` writes one row per human-wait exception into `alerts`:
decisions, stalled requests, over-budget work, criteria awaiting approval,
pipeline stage gates, human gates awaiting verification, and recent hard
cancellations. On each tick, `deliverAttention` prompts the Clara session linked
to the request, marks the alert with `session_id` and `notified_at`, and leaves
failed prompts for the next tick. A reopened gate clears its delivery marker.

`clara_attention` turns the alert into a standard OpenCode form (`feedback`,
`form`, or `confirm`) or a plain information message (`info`). Forms make the
session **Needs Input**; information stays **Ready for Review**. If the plugin
cannot create a form, the tool falls back to a prose question in the normal
composer.

## Not built yet

- Worktree and branch creation. Workers run in the workspace directory.
- Cost rollups for accepted requests.
- A pipeline editor; JSON files and the CLI are the authoring surface.
- Generated user agents; a stage references an agent the user installs.
- Parallel stages, branching, or loops.
- A panel view of the alert outbox; the panel shows ledger storage health.
- A one-click confirmation control; `confirm` uses a boolean form field plus
  Submit.
