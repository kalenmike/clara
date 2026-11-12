# Orchestration DSL

## Summary

The orchestration DSL describes packages, pipelines, steps, agents, routers, and
scripts as YAML and Markdown data. The engine loads that data, resolves imports
and inheritance, and compiles one pinned tree before a run starts. This page is
the full field reference; [orchestration.md](orchestration.md) describes the
service and run lifecycle.

## Active config

The engine ships a default config at
`packages/orchestration/engine/default/index.yml`. It imports the five standard
packages and declares the classifier router, so a fresh install can start a run
without a workspace config. The workspace is only the directory where workers
run, scripts execute, and artifacts live; it does not have to contain a config.

To use custom routing, point `CLARA_ORCHESTRATION_CONFIG` at an `index.yml` (or
pass `--config` to Clara Lab). The file can live anywhere. Its imports are
resolved relative to that file, while `std:` imports always resolve to the
standard packages bundled with the engine. A missing explicit config fails with
`config_missing`; otherwise the bundled default is used.

The root `index.yml` is a package manifest with one extra root-only section,
`overrides`. Unknown top-level keys are ignored; the `watchdog` block is
reserved until the orchestrator wiring lands.

## Package layout

A package is a directory with an `index.yml` (or `index.yaml`):

```text
my-package/
  index.yml
  pipelines/*.yml
  routers/*.md
  agents/*.md
  scripts/*.yml
```

`index.yml` can point `defaults.agent_dir` and `defaults.script_dir` at other
directories. A YAML file can also be imported directly as a synthetic package;
that form only supports pipelines (`pipelines` map or a single pipeline with an
`id`), not routers, agents, or scripts.

Discovered names:

| Asset    | Name source                                              |
| -------- | -------------------------------------------------------- |
| Pipeline | `pipelines.<id>`, or the file's `id`                     |
| Router   | frontmatter `id`, or the file name                       |
| Agent    | frontmatter `id`, or the relative path without extension |
| Script   | `name` or `id`, or the relative path without extension   |

## Manifest

```yaml
id: my-package
name: My package
version: 1
description: Optional summary
is_active: true
entry:
  pipeline: main # or: router: classifier

imports:
  std:
    - path: software
    - path: content
  local:
    - path: ./packages/extra
    - path: ../shared-package
    - path: ./single-pipeline.yml
      select: [main, review]

defaults:
  model: a-model
  provider: a-provider
  agent_dir: ./agents
  script_dir: ./scripts
  enforcement: observed

router:
  id: classifier
  path: ./routers/classifier.md
  routes:
    - when: code
      criteria: a software request
      run: std:software

pipelines:
  inline:
    steps:
      - name: one
        type: agent
```

| Field              | Meaning                                                               |
| ------------------ | --------------------------------------------------------------------- |
| `id`               | Lowercase letters, digits, and dashes. Defaults to the directory name |
| `name`             | Display name. Defaults to `id`                                        |
| `version`          | Positive integer. Defaults to `1`                                     |
| `description`      | Optional manifest description                                         |
| `is_active`        | `false` fails the load                                                |
| `entry`            | A pipeline id, `{pipeline}`, or `{router}`                            |
| `imports`          | Namespaces of package paths; see below                                |
| `defaults`         | Inherited model, provider, directories, and enforcement               |
| `router`           | Inline router declaration; see below                                  |
| `pipelines`        | Inline pipeline definitions keyed by id                               |
| `default_model`    | Legacy alias for `defaults.model`                                     |
| `default_provider` | Legacy alias for `defaults.provider`                                  |

### Imports

```yaml
imports:
  std:
    - path: software
    - path: research
  mine:
    - path: ./packages/one
    - path: /absolute/packages/two
      select: [build, review]
```

- The namespace must match `[a-z0-9][a-z0-9-]*`.
- Absolute paths are used as-is.
- `./` and `../` paths resolve from the importing package directory.
- A bare `path` under the `std` namespace resolves to the bundled standard
  packages.
- A bare path under any other namespace resolves from the importing package.
- `select` keeps only the named pipelines. If it removes the package entry, the
  first selected pipeline becomes the entry.
- A package import cycle, an inactive package, or an import deeper than eight
  levels is a load error.

A reference is `namespace:package` for a package entry, or
`namespace:package/pipeline` for a named pipeline. A bare package id selects its
entry. If a package id and a pipeline in the same package share a name, the
pipeline wins for a bare ref.

### Entry resolution

`entry` wins when declared. Otherwise the loader picks a single router, then a
single pipeline, then no entry. A run with no entry and no explicit target is a
compile error.

### Overrides

`overrides` is root-only and only changes model and provider selection. Keys are
`namespace:package`; a pipeline suffix is invalid.

```yaml
overrides:
  std:software:
    defaults:
      provider: a-provider
      model: a-model
    pipelines:
      feature:
        default_provider: a-provider
        default_model: a-model
    agents:
      code_review:
        model: a-model
```

Unknown packages, pipelines, agents, or keys fail at load time. Overrides are
applied before compilation, so the preview, snapshot, and hash include them.

### Defaults and model precedence

`defaults` is inherited by the root package and every imported package. A
package can set its own values. Model and provider resolve independently, from
most specific to least:

1. step `model` / `provider`
2. pipeline `default_model` / `default_provider`
3. agent frontmatter `model` / `provider`
4. package `defaults.model` / `defaults.provider`
5. the run's fallback workspace defaults

A step may set only one half; the other is inherited. The bundled standard
packages do not pin a model, so the default config does not either. The harness
then uses its own default.

### Router manifest block

```yaml
router:
  id: classifier
  path: ./routers/classifier.md
  strategy: llm_classify
  routes:
    - when: code
      criteria: a software request
      run: std:software
```

- `path` loads a router Markdown file.
- `id` overrides the file id; it is required when there is no `path`.
- `strategy` overrides the file's strategy.
- `routes` replaces the file's routes when declared.
- The block can add or extend a router discovered under `routers/`.

`strategy` is accepted for compatibility. Current routing is LLM classification;
`fixed` is not implemented.

## Pipelines

```yaml
id: feature
name: Feature development
description: Optional summary
default_model: a-model
default_provider: a-provider
enforcement: strict
policy:
  edit:
    allow: ['src/**']
limits:
  turns:
    initial: 30
    growth_rate: 5
    absolute_max: 60
  tokens:
    initial: 200000
    growth_rate: 1.5
    absolute_max: 500000
requires:
  adapter: opencode
  capabilities: [tool_policy]
notification:
  success: true
steps:
  - name: spec
    type: agent
```

| Field              | Meaning                                                |
| ------------------ | ------------------------------------------------------ |
| `id`               | Pipeline key; required for a standalone file           |
| `name`             | Display name; defaults to `id`                         |
| `version`          | Positive integer; defaults to `1`                      |
| `description`      | Optional summary                                       |
| `default_model`    | Model for this pipeline's steps                        |
| `default_provider` | Provider for this pipeline's steps                     |
| `enforcement`      | `observed`, `strict`, or `sandboxed`                   |
| `policy`           | Permission policy inherited by steps                   |
| `limits`           | Resource limits inherited by steps                     |
| `requires`         | Run-level adapter, runner, or capability requirement   |
| `notification`     | Accepted; delivery is currently handled by the adapter |
| `steps`            | Non-empty step list                                    |

A pipeline declared in a `pipelines/*.yml` file can be a single pipeline with
`id`, or a map under `pipelines`.

## Steps

A step has one of five types:

| Type       | Executor        | Output                              |
| ---------- | --------------- | ----------------------------------- |
| `agent`    | harness adapter | model text or JSON result           |
| `router`   | harness adapter | one route key                       |
| `script`   | runner          | stdout, exit code, or parsed JSON   |
| `pipeline` | orchestrator    | referenced or inline child pipeline |
| `group`    | orchestrator    | inline child steps                  |

`type` defaults to `group` when `steps` is present, otherwise `agent`.

### Common fields

| Field         | Meaning                                                     |
| ------------- | ----------------------------------------------------------- |
| `name` / `id` | Step name; required and unique within its container         |
| `type`        | One of the five types above                                 |
| `title`       | Display title; defaults to `name`                           |
| `description` | Summary, and a prompt fallback                              |
| `prompt`      | Inline prompt for an agent or router step                   |
| `agent`       | Agent document name; defaults to the step name              |
| `model`       | Model override                                              |
| `provider`    | Provider override                                           |
| `policy`      | Permission policy override                                  |
| `limits`      | Resource limits override                                    |
| `retries`     | `{ auto_attempts }`                                         |
| `on_failure`  | Bounded recovery branch                                     |
| `enforcement` | Step enforcement override                                   |
| `requires`    | Adapter, runner, or capability requirement                  |
| `background`  | Start a group child without waiting for it                  |
| `request`     | Include the root request in an agent prompt; default `true` |
| `inputs`      | Label to earlier sibling step                               |
| `artifacts`   | Label to a workspace-relative path or glob                  |
| `source`      | Source path recorded in the compiled tree                   |

### Agent steps

An agent step renders a prompt from the first available source:

1. step `prompt`
2. the agent document body
3. step `description`
4. a generated instruction

The agent document is the step's `agent` name, or the step name. The loader also
tries the name with a `namespace:` prefix removed. A missing document is a
diagnostic warning and uses the next prompt source, not a hard load error.

Agent agents inherit model, provider, policies, limits, and retries from the
document unless the step overrides them. The prompt is the Markdown body after
the frontmatter.

### Router steps

```yaml
steps:
  - name: choose
    type: router
    prompt: Choose one route.
    routes:
      - when: code
        criteria: a software request
        run: std:software
```

- A router step either names a `path` to a router Markdown file or declares
  `routes`.
- `prompt` or `description` supplies the instructions for an inline router.
- Every route needs `when` and `run`; `criteria` or `description` tells the
  classifier when to choose it.
- The rendered route list replaces `[ROUTES]` in the router instructions, or is
  appended under `## Routes`.
- The classifier returns exactly one `when` key. An unknown key or missing route
  fails the step; prose is never inferred as a route.

### Script steps

```yaml
steps:
  - name: build
    type: script
    command: pnpm build --json
    timeout_seconds: 900
    result_mode: json
    success_codes: [0]
```

Or reference a reusable script document:

```yaml
steps:
  - name: build
    type: script
    script: build
```

```yaml
# scripts/build.yml
name: build
description: Build the workspace
command: pnpm build --json
interpreter: /bin/bash
cwd: .
env:
  CI: '1'
pass_env: [NODE_OPTIONS]
timeout_seconds: 900
success_codes: [0]
result_mode: json
max_output_bytes: 65536
```

- `script` and `command` are mutually exclusive, and one is required.
- `prompt`, `model`, and `provider` are load errors on a script step.
- A step value overrides the same field from the script document.
- `cwd` must stay inside the workspace.
- The runner receives a small base environment, the declared `env`, and the
  `pass_env` variables.
- Declared inputs are written to temporary files and exposed as
  `CLARA_INPUT_<LABEL>` and `CLARA_INPUTS`; artifacts are indexed at
  `CLARA_ARTIFACTS`; the root request is in `CLARA_REQUEST`.
- `result_mode` is `auto`, `json`, `text`, `exit`, or `tail`. `auto` uses JSON
  when stdout parses, otherwise `{ exit_code, stdout, stderr }`. `json` fails on
  unparseable or empty output.
- A nonzero exit fails the step unless it is in `success_codes` (default `[0]`).
- `timeout_seconds` defaults to `limits.wall_clock_seconds` when set, then to
  900 seconds. `max_output_bytes` defaults to 64 KiB.
- Script output is streamed as `step.output` and capped.
- Scripts default to one attempt unless `retries.auto_attempts` is set.

### Pipeline and group steps

```yaml
steps:
  - name: implementation
    type: pipeline
    ref: std:software/feature
    inputs:
      spec: spec

  - name: checks
    type: group
    steps:
      - name: tests
        type: script
        command: pnpm test
      - name: docs
        type: script
        command: pnpm docs:check
```

- `type: pipeline` with `ref` compiles the referenced pipeline and overlays the
  step's path, inputs, artifacts, request scope, background flag, model,
  provider, policy, limits, enforcement, and retries.
- `type: pipeline` with `steps`, or `type: group`, runs inline children. These
  are containers, not separately addressable packages.
- A container is done when all children are done, failed when any child fails,
  and running otherwise.

### Inputs and artifacts

```yaml
steps:
  - name: spec
    type: agent
  - name: review
    type: agent
    inputs:
      specification: spec
    artifacts:
      spec: spec.md
      docs: docs/README.md
```

- Both accept a map or a list. A list uses the value as both label and target.
- An input must name an earlier sibling in the same container. Unknown, forward,
  self, and `background` references fail at compile time.
- An input result is rendered in full for an agent. A script receives it as a
  file and in the input index. Undeclared results are never pushed.
- Artifacts are paths, not contents. Absolute paths and `..` are compile errors.
- A step with no inputs receives no earlier result, only its artifacts and the
  request reference.

### Background and request scope

- `background: true` starts a group child without waiting for it. The group fails
  fast if a background child fails. A background child cannot be an input source
  because its result is not guaranteed.
- `request: false` omits the root request from an agent prompt. Routers always
  receive the request as their primary input; this flag only affects non-router
  prompts.
- The worker prompt order is: step prompt, declared inputs, artifacts, previous
  attempt, request reference, finish instruction.

### Retries and recovery

```yaml
steps:
  - name: verify
    type: agent
    retries:
      auto_attempts: 2
    on_failure:
      max_cycles: 1
      retry: true
      steps:
        - name: fix
          type: script
          command: pnpm fix
```

- `retries.auto_attempts` is the number of attempts for the step. Agent and
  router steps default to three; scripts default to one.
- `on_failure` is only allowed on agent, script, and router steps.
- `max_cycles` is an integer from 1 to 3 and defaults to 1.
- `retry` defaults to `true`. A successful recovery retries the failed step with
  one extra attempt; `false` completes the step from the recovery result.
- Recovery steps run at `<step>/on_failure/<n>-<name>`, receive the failed
  attempt as context, and cannot declare nested recovery.
- A failed recovery fails the run with both errors. A successful recovery emits
  `step.recovered` instead of a failure alert.
- Recovery steps cannot reference the failed step through `inputs`.

### Policies

```yaml
policy:
  tools:
    allow: [read, grep]
    deny: [task]
  edit:
    allow: ['src/**']
    deny: ['.env*']
  shell:
    deny: ['rm -rf *']
  network:
    allow: ['https://docs.example.com/**']
  subagents: deny
  rules:
    - action: edit
      resource: 'docs/**'
      effect: allow
```

| Field       | Meaning                                                                             |
| ----------- | ----------------------------------------------------------------------------------- |
| `tools`     | Tool name allow/deny globs                                                          |
| `edit`      | Edit, write, and patch path globs                                                   |
| `shell`     | Shell command globs                                                                 |
| `network`   | Fetch and network target globs                                                      |
| `subagents` | `managed`, `allow`, or `deny`; `deny` blocks the `task` tool                        |
| `rules`     | Ordered `{ action, resource, effect }` rules; `effect` is `allow`, `deny`, or `ask` |

Matching uses the policy glob rules. A step's policy overrides the agent's
policy fields; the rule lists from the inherited container policy, the step or
agent policy, agent permissions, and step permissions are combined. `observed`
steps record denials without blocking; `strict` and `sandboxed` steps block and
count violations.

### Limits

```yaml
limits:
  turns:
    initial: 20
    growth_rate: 5
    absolute_max: 40
  tokens:
    initial: 150000
    growth_rate: 1.5
    absolute_max: 400000
  max_tool_calls: 200
  wall_clock_seconds: 1800
  max_violations: 3
  on_exhausted: fail
```

| Field                 | Default     | Meaning                                                                   |
| --------------------- | ----------- | ------------------------------------------------------------------------- |
| `turns.initial`       | 10          | Turns for the first attempt                                               |
| `turns.growth_rate`   | 0           | Added turns per later attempt                                             |
| `turns.absolute_max`  | `initial`   | Hard turn ceiling                                                         |
| `tokens.initial`      | 100000      | Tokens for the first attempt                                              |
| `tokens.growth_rate`  | 1           | Multiplier per later attempt                                              |
| `tokens.absolute_max` | `initial`   | Hard token ceiling                                                        |
| `max_tool_calls`      | `turns * 8` | Tool-call ceiling                                                         |
| `wall_clock_seconds`  | 3600        | Step wall-clock ceiling                                                   |
| `max_violations`      | 3           | Denials allowed before the step stops                                     |
| `on_exhausted`        | `keep`      | `keep` accepts an over-budget result; `fail` retries with a larger budget |

Turn and token limits grow per attempt. The final 8% of the token budget (capped
at 10,000 tokens) is reserved for the worker's report, and Clara control tools
remain available after a budget denial.

### Requirements

```yaml
requires:
  adapter: opencode
  runner: build-host
  capabilities: [tool_policy, turn_limit, token_limit]
```

- `adapter` pins agent and router work to a harness identity when the step is
  claimed. A pipeline or router `requires.adapter` also gates a strict run at
  start.
- `runner` releases a script step only to a runner with that id or label.
- `capabilities` adds required capabilities to the leaf.
- A strict pipeline with no live capable adapter fails closed at start. A script
  step with no capable runner waits until `CLARA_RUNNER_WAIT_MS`, then opens a
  `no_runner` alert.

## Agent documents

```markdown
---
id: code_review
description: Review the change
model: a-model
provider: a-provider
permissions:
  - action: shell
    resource: '*'
    effect: deny
policy:
  edit:
    allow: ['src/**']
limits:
  turns:
    initial: 20
retries:
  auto_attempts: 2
---

Review the implementation and report blocking issues.
```

Frontmatter is optional. The body is the prompt. Supported frontmatter:
`id`, `description`, `model`, `provider`, `permissions`, `policy`, `limits`, and
`retries`.

## Router documents

```markdown
---
id: classifier
description: Pick one route
strategy: llm_classify
permissions:
  - action: edit
    resource: '*'
    effect: deny
limits:
  turns:
    initial: 1
    absolute_max: 2
---

Pick exactly one route.

[ROUTES]
```

Supported frontmatter: `id`, `description`, `strategy`, `routes`, `permissions`,
`policy`, `limits`, `enforcement`, and `requires`. The body is the instruction
prompt. The manifest `router` block can supplement or replace these values.

## Compilation and validation

The loader walks imports, discovers assets, applies overrides, and compiles a
tree. Compilation fails on:

- an inactive package, import cycle, or import depth over eight;
- a missing entry, pipeline, router file, or script document;
- a pipeline or group with no steps;
- a script step with both `script` and `command`, neither, or a prompt/model;
- a router step with neither `path` nor `routes`;
- duplicate sibling step names, invalid input references, or unsafe artifact
  paths;
- pipeline or router reference cycles;
- nested recovery branches or invalid `on_failure` bounds.

The compiled tree, package ids and versions, source files, and resolved
overrides form the run snapshot. The snapshot hash is the pinned identity used
by the Lab diff and run history.

## Runtime behavior

- A pipeline container is done only when every child is done. A failure in any
  child fails the container, even if a live sibling is still running.
- A router records its chosen route and stays done; the selected branch carries
  the failure.
- When a run ends failed or cancelled, every live step settles in one
  transaction: the failing step stays failed, interrupted work becomes
  cancelled, and work that never started becomes skipped.
- Every claim appends an immutable attempt row with its own result, usage,
  timings, model, and error. A retry never overwrites the previous attempt.
- `background` children are best-effort concurrency; their results are not
  available as inputs.

## Reserved settings

These fields are accepted by the loader but are not yet consumed by the
orchestrator. They are reserved for the next wiring pass and must not be relied
on for behavior:

| Field                     | Current behavior                                                                                                         |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| root `watchdog`           | The service uses `CLARA_ORCHESTRATION_STALLED_MS`, the lease duration, and `CLARA_RUNNER_WAIT_MS`; the block is not read |
| pipeline `notification`   | Alerts and terminal runs are delivered by the adapter, not this block                                                    |
| router or step `strategy` | Routing is LLM classification; `fixed` is not implemented                                                                |
| `schemaVersion`           | Recorded as metadata only                                                                                                |

## See also

- [orchestration.md](orchestration.md) for the service, run lifecycle, and MCP.
- [lab.md](lab.md) for previewing and driving a package.
- [capabilities.md](capabilities.md) for shipped scope.
