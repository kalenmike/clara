---
title: Package and pipeline reference
kind: reference
---

# Package and pipeline reference

Packages, pipelines, steps, agents, routers, and scripts are YAML and Markdown
data. The engine resolves imports and inheritance and compiles one pinned tree
before a run starts. This is the field reference; run mechanics live in
[execution.md](execution.md).

## Active config

The default config is `packages/orchestration/engine/default/index.yml`. It
imports the five standard packages and declares the classifier router, so a
fresh install starts without a workspace config. Point `CLARA_ENGINE_CONFIG` at
an `index.yml` (or pass `--config` to Clara Lab) for custom routing: its imports
resolve relative to that file, while `std:` imports resolve to the bundled
packages. A missing explicit config fails with `config_missing`; otherwise the
bundled default applies. The root `index.yml` is a manifest plus root-only
`overrides`; unknown keys are ignored and `watchdog` is reserved.

## Package layout

```text
my-package/{index.yml,pipelines/*.yml,routers/*.md,agents/*.md,scripts/*.yml}
```

`defaults.agent_dir` and `defaults.script_dir` can point elsewhere. A YAML file
imported directly is a synthetic package that supports pipelines only. Names
come from `pipelines.<id>` or a pipeline `id`; router and agent frontmatter `id`
or the file name; script `name`/`id` or the path without extension.

## Manifest

```yaml
id: my-package
version: 1
entry: { pipeline: main } # or { router: classifier }
imports:
  std: [{ path: software }]
  mine: [{ path: ./shared-package, select: [main, review] }]
defaults: { model: a-model, provider: a-provider, enforcement: observed }
router: { id: classifier, path: ./routers/classifier.md }
pipelines: { inline: { steps: [{ name: one, type: agent }] } }
```

Keys are `id` (defaults to the directory name), `name` and `version` (default
`id` and `1`), `description`, `is_active` (`false` fails the load), `entry`,
`imports`, `defaults`, `router`, and `pipelines`. `default_model` and
`default_provider` are legacy aliases for `defaults.model` and
`defaults.provider`.

## Imports and entries

- Namespaces match `[a-z0-9][a-z0-9-]*`. Absolute paths are used as-is; `./` and
  `../` resolve from the importing package.
- A bare path under `std` resolves to the bundled packages; under any other
  namespace it resolves from the importing package.
- `select` keeps named pipelines. If it removes the package entry, the first
  selected pipeline becomes the entry.
- An import cycle, an inactive package, or depth over eight levels is a load
  error. `entry` wins when declared; otherwise the loader picks a single router,
  then a single pipeline, and no entry with no explicit target is a compile
  error.
- A reference is `namespace:package` for an entry or
  `namespace:package/pipeline` for a named pipeline; a bare package id selects
  its entry, and a pipeline wins when both share a bare name.

## Overrides and model precedence

`overrides` is root-only, keyed by `namespace:package` (no pipeline suffix), and
changes model and provider selection only. It accepts `defaults`,
`pipelines.<id>`, and `agents.<name>`; unknown keys fail at load time, and it
applies before compilation, so preview, snapshot, and hash include it.

```yaml
overrides:
  std:software:
    defaults: { provider: a-provider, model: a-model }
    agents: { code_review: { model: a-model } }
```

Model and provider resolve independently, most specific first:

1. step `model` / `provider`
2. pipeline `default_model` / `default_provider`
3. agent frontmatter `model` / `provider`
4. package `defaults.model` / `defaults.provider`
5. workspace `defaults`

A step may set one half only; the other is inherited. Standard packages pin
no model, so a fresh install follows the harness default (`model_unset`).

## Pipelines

A pipeline declares `id` (its key, required in a standalone file), `name` and
`version` (default `id` and `1`), `description`, `default_model`,
`default_provider`, `enforcement`, `policy`, `limits`, `requires`, and
`notification` (delivery is adapter-handled). `steps` must be non-empty, and a
`pipelines/*.yml` file is either one pipeline with `id` or a map under
`pipelines`.

## Steps

`type` defaults to `group` when `steps` is present, otherwise `agent`.

| Type       | Executor        | Output                            |
| ---------- | --------------- | --------------------------------- |
| `agent`    | harness adapter | model text or JSON result         |
| `router`   | harness adapter | one route key                     |
| `script`   | runner          | stdout, exit code, or parsed JSON |
| `pipeline` | engine          | referenced or inline children     |
| `group`    | engine          | inline child steps                |

| Field                             | Meaning                                                     |
| --------------------------------- | ----------------------------------------------------------- |
| `name` / `id`                     | Step name; required and unique within its container         |
| `type`                            | One of the five types above                                 |
| `title`, `description`            | Display title (default `name`); summary and prompt fallback |
| `prompt`                          | Inline prompt for an agent or router step                   |
| `agent`                           | Agent document name; defaults to the step name              |
| `model`, `provider`               | Model and provider overrides                                |
| `policy`, `limits`, `enforcement` | Permission, resource, and enforcement overrides             |
| `requires`                        | Adapter, runner, or capability requirement                  |
| `retries`, `on_failure`           | `{ auto_attempts }`; bounded recovery branch                |
| `background`, `request`           | Run a child without waiting; include the root request       |
| `inputs`, `artifacts`             | Label to an earlier sibling step; label to a path or glob   |
| `source`                          | Source path recorded in the compiled tree                   |

### Agent steps

The prompt comes from the first available source: step `prompt`, the agent
document body, step `description`, then a generated instruction. The document is
the step's `agent` name or the step name, with a `namespace:` prefix tried
stripped; a missing document is a diagnostic warning. Model, provider, policy,
limits, and retries come from the document unless the step overrides them.

### Router steps

A router step names a `path` to a router Markdown file or declares inline
`routes`; `prompt` or `description` supplies inline instructions. Every route
needs `when` and `run`; `criteria` (or legacy `description`) tells the classifier
when to choose it. The classifier returns exactly one `when` key: an unknown key
or missing route fails the step, and prose is never inferred.

### Script steps

```yaml
steps:
  - name: build
    type: script
    command: pnpm build --json
    timeout_seconds: 900
    result_mode: json
    success_codes: [0]
  - { name: lint, type: script, script: lint } # scripts/lint.yml
```

A script document holds the same fields plus `name`, `interpreter`, `cwd`,
`env`, `pass_env`, and `max_output_bytes`; a step value overrides it.

- `script` and `command` are mutually exclusive and one is required; `prompt`,
  `model`, and `provider` are load errors. `cwd` must stay inside the workspace,
  and the runner gets a small base environment plus `env` and `pass_env`.
- Inputs become temporary files exposed as `CLARA_INPUT_<LABEL>` and
  `CLARA_INPUTS`; artifacts are indexed at `CLARA_ARTIFACTS`; the request is in
  `CLARA_REQUEST`.
- `result_mode` is `auto`, `json`, `text`, `exit`, or `tail`; `auto` uses JSON
  when stdout parses, otherwise `{ exit_code, stdout, stderr }`, and `json` fails
  on unparseable or empty output. A nonzero exit fails the step unless it is in
  `success_codes` (default `[0]`). `timeout_seconds` defaults to
  `limits.wall_clock_seconds`, then 900; `max_output_bytes` is 64 KiB; output
  streams as `step.output`.

### Pipeline and group steps

`type: pipeline` with `ref` compiles the referenced pipeline and overlays the
step's path, inputs, artifacts, request scope, background flag, model, provider,
policy, limits, enforcement, and retries. `type: pipeline` with `steps`, or
`type: group`, runs inline children; these are containers, not addressable
packages.

### Inputs, artifacts, and request scope

`inputs` and `artifacts` accept a map or a list (the value is then both label and
target). An input must name an earlier sibling in the same container; unknown,
forward, self, and `background` references fail at compile time. Artifacts are
paths, not contents; absolute paths and `..` are compile errors.
`background: true` starts a group child without waiting and makes its result
unavailable as an input. `request: false` omits the root request from a
non-router prompt; routers always receive it.

### Retries and recovery

`retries.auto_attempts` is the attempt count: three by default for agent and
router steps, one for scripts. `on_failure` is allowed only on agent, router, and
script leaves; it takes `max_cycles` (1-3, default 1), `retry` (default true),
and `steps`, and a nested recovery branch is a load error. Recovery steps run at
`<step>/on_failure/<n>-<name>`, receive the failed attempt as context, and ignore
`inputs` that name the failed step. `retry: true` retries the step with one extra
attempt; `false` completes it from the recovery result. A successful recovery
emits `step.recovered` instead of a failure alert; a failed one fails the run
with both errors.

## Policies and limits

`policy` takes `tools`, `edit`, `shell`, and `network` allow/deny globs;
`subagents` (`managed`, `allow`, or `deny`, which blocks the task tool); and
ordered `rules` as `{ action, resource, effect }` with `allow`, `deny`, or `ask`.
A step's policy overrides the agent's fields, while rule lists from the inherited
container, step or agent policy, and permissions are combined.

```yaml
policy:
  edit: { allow: ['src/**'], deny: ['.env*'] }
  rules: [{ action: edit, resource: 'docs/**', effect: allow }]
```

Limits take `turns`, `tokens`, `max_tool_calls`, `wall_clock_seconds`,
`max_violations`, and `on_exhausted`:

| Field                 | Default     | Meaning                                              |
| --------------------- | ----------- | ---------------------------------------------------- |
| `turns.initial`       | 10          | Turns for the first attempt                          |
| `turns.growth_rate`   | 0           | Added turns per later attempt                        |
| `turns.absolute_max`  | `initial`   | Hard turn ceiling                                    |
| `tokens.initial`      | 100000      | Tokens for the first attempt                         |
| `tokens.growth_rate`  | 1           | Multiplier per later attempt                         |
| `tokens.absolute_max` | `initial`   | Hard token ceiling                                   |
| `max_tool_calls`      | `turns * 8` | Tool-call ceiling                                    |
| `wall_clock_seconds`  | 3600        | Step wall-clock ceiling                              |
| `max_violations`      | 3           | Denials allowed before the step stops                |
| `on_exhausted`        | `keep`      | `keep` accepts an over-budget result; `fail` retries |

Limits grow per attempt. The last 8% of the token budget (capped at 10,000) is
reserved for the worker's report, and Clara control tools stay available after a
budget denial. `observed` steps record denials without blocking; `strict` and
`sandboxed` steps deny and count violations.

## Requirements

`requires.adapter` pins agent and router work to a harness identity, and a
pipeline or router requirement also gates a strict run at start. `runner`
releases a script step only to a runner with that id or label, and `capabilities`
adds required capabilities to the leaf. A strict pipeline with no live capable
adapter fails closed; a script step with no capable runner waits
`CLARA_RUNNER_WAIT_MS` (60 s) then gets a `no_runner` alert.

## Agent and router documents

```markdown
---
id: code_review
model: a-model
limits: { turns: { initial: 20 } }
---

Review the implementation and report blocking issues.
```

Frontmatter is optional and the body is the prompt. Agent keys: `id`,
`description`, `model`, `provider`, `permissions`, `policy`, `limits`, and
`retries`. Router documents add `strategy`, `routes`, `enforcement`, and
`requires`; their body carries `[ROUTES]` or gets an appended route list, and the
manifest `router` block can supplement or replace their values.

## Compilation and validation

The loader walks imports, discovers assets, applies overrides, and compiles a
tree. Compilation fails on an inactive package, import cycle, or depth over
eight; a missing entry, pipeline, router file, or script document; a pipeline or
group with no steps; a script step with both `script` and `command`, neither, or
a prompt/model; a router step with neither `path` nor `routes`; duplicate sibling
step names, invalid input references, or unsafe artifact paths; pipeline or
router reference cycles; and nested recovery branches or invalid `on_failure`
bounds.

The compiled tree, package ids and versions, source files, and resolved
overrides form the run snapshot; its hash is the pinned identity used by the Lab
diff and run history.

## Runtime behavior

- A container is done only when every child is done and failed when any child
  fails, even if a live sibling is still running. A router records its route and
  stays done, and the selected branch carries the failure.
- When a run ends failed or cancelled, every live step settles in one
  transaction: the failing step stays failed, interrupted work becomes
  cancelled, and unstarted work becomes skipped.
- Every claim appends an immutable attempt row; a retry never overwrites it.
  `background` children are best-effort and their results are not inputs.

## Reserved settings

Accepted but not consumed: root `watchdog` (the service uses
`CLARA_ENGINE_STALLED_MS`, the lease duration, and the runner wait), pipeline
`notification` (adapter-delivered), router or step `strategy` (LLM only;
`fixed` unimplemented), and `schemaVersion` (metadata only).
