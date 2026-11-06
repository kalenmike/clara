# Pipeline

## Summary

A pipeline is the configurable part of a Clara request: the ordered stages, the
agent that runs each one, the handoff instructions, and the evidence a stage
must record before the daemon advances. The Clara lifecycle stays fixed, so the
same ledger can run software work, content work, research, or any other linear
process. Settings also shows the built-in and custom pipelines that are
available on the home agent.

## User flow

1. Open Settings → Pipelines to see the built-in presets and every custom file
   the home agent loaded. Each pipeline expands into its ordered stages.
2. Start from the built-in `software` or `content` preset, or create a pipeline
   JSON file under `${CLARA_CONFIG_DIR:-~/.config/clara}/pipelines/`.
3. Validate it with `pnpm clara ledger pipeline validate <id-or-file>`.
4. Select it for a workspace with
   `pnpm clara ledger pipeline select <workspace> <id>`, or pass `pipeline` on
   `clara_submit`.
5. Submit a request. The request stores the pipeline id, version, hash, and a
   full snapshot.
6. The daemon runs the contract stage. The agent proposes criteria and calls
   `clara_stage_done`.
7. A human approves the criteria with `clara_approve`. Work stages run in order.
8. If a stage declares a human gate, a human records it with
   `clara_stage_gate`.
9. Review stages run, then the close stage records `result` and `artifacts`.
10. The request completes. `clara_ask` shows the result and the evidence.

## Core business rules

1. **The lifecycle is fixed.** A request moves through `draft`, `approved`,
   `running`, `review`, `completed`, or `cancelled`. Pipelines cannot add or
   remove lifecycle states.
2. **A pipeline has one contract stage and one close stage.** The contract stage
   is first; the close stage is last. Work and review stages may be empty.
3. **Stages are linear.** Each stage runs once, in order. A stage may be skipped
   by a simple `when` condition. There is no branching, parallelism, or looping.
4. **Completion is explicit evidence.** The stage agent calls
   `clara_stage_done` with the evidence its definition declares. A session that
   ends without that call is a failed stage and opens a decision.
5. **Definitions are user-level.** Pipeline files live outside the workspace. A
   repository cannot define an agent with shell access.
6. **Requests pin their pipeline.** Editing a file never reinterprets an
   in-flight request. New requests use the new definition.
7. **Agents are referenced, not generated.** A stage names an existing OpenCode
   agent. Clara validates the definition shape; a missing agent opens a decision
   when the stage is due. The pipelines Clara ships only name agents defined in
   `agents.json`, and the self-test checks that.
8. **Only the closer closes.** The close stage must use `role: "closer"`. The
   human approval and review gates remain the only way to bypass a stage
   failure.
9. **The Settings catalog is read-only.** It shows the shipped presets and the
   custom files the home agent loaded, grouped by source. A custom file with the
   same id as a preset is shown beside the preset it replaces; requests already
   in flight keep their pinned version.

## Edge cases

- The pipeline file is invalid: `validate`, `submit`, and `select` fail with the
  field path. In-flight requests are unaffected because they use snapshots. The
  Settings catalog lists the file and its validation errors instead of a
  runnable pipeline.
- A custom file overrides a preset: Settings shows both the shipped preset and
  the custom replacement, with an override note.
- Clara management is off: Settings still shows the catalog for reference, with
  a notice that new requests will not run the pipelines.
- The browser is connected directly to OpenCode rather than through the Clara
  home agent: the Pipelines tab is hidden because there is no catalog to read.
- The workspace has no selected pipeline: `software` is used. `content` is
  available as a second built-in preset; select it per workspace or per submit.
- The selected pipeline file is deleted: new requests fail; in-flight requests
  keep their snapshot.
- A stage condition references evidence that was not produced: the condition is
  false and the stage is recorded as skipped.
- A stage declares a human gate: the daemon waits and the alert outbox reports
  `stage_gate` until a human records `clara_stage_gate`.
- A required evidence key is missing or has the wrong type: `clara_stage_done`
  refuses the completion.
- An immutable evidence key gets a different value: the completion is refused.
- A worker tries to complete another stage: the tool refuses because the live
  run owns one stage.
- A missing agent or model: the daemon opens a blocked decision instead of
  crashing.
- The close stage is reached before every prior stage completes: the completion
  is refused.
- A human-verification criterion is unverified: the close stage cannot complete.

## Out of scope

- Editing, creating, deleting, reordering, or selecting pipelines from Settings
  (the current catalog is view-only).
- A pipeline editor in the panel.
- Clara generating or overwriting agent definitions.
- Parallel stages, branching, loops, or a general expression language.
- Auto-loading a pipeline file committed inside a workspace.
- Multiple pipelines running at once for one request.
- Mid-flight pipeline switching.
- Blob artifact storage; artifacts are paths, URLs, or text.

## Known gaps

- Agent existence is checked when the stage is about to spawn, not at submit.
  The shipped examples are audited against `agents.json`; a user pipeline that
  names an uninstalled agent fails only when that stage comes due.
- Automated and artifact criteria rely on the stage's declared evidence; Clara
  does not execute a check command.
- The optional progress guard compares one numeric metric across reports. It
  does not understand compound metrics.

## Technical appendix

<details>
<summary>File shape, CLI, and integration</summary>

- Directory: `${CLARA_CONFIG_DIR:-${XDG_CONFIG_HOME:-~/.config}/clara}/pipelines`
- One JSON file per pipeline. A file whose `id` matches a preset (`software` or
  `content`) overrides that preset.
- Built-in presets: `software` and `content`; reference copies live in
  `plugins/clara/pipelines/`.
- Example agents: `software` uses `001`–`004` and `judge`; `content` uses
  `clara-brief`, `clara-writer`, `clara-editor`, and the same `judge` closer.
  All of them are installed by `pnpm clara plugin install`. The content agents
  keep their copy in stage evidence and have no shell; add an `edit` scope to a
  copied pipeline if your stages must write files.
- Commands:
  - `pnpm clara ledger pipeline list`
  - `pnpm clara ledger pipeline validate <id-or-file>`
  - `pnpm clara ledger pipeline select <workspace> <id> [--path <workspace>]`
  - `pnpm clara ledger pipeline show <request|workspace|id>`
- Settings reads the catalog over the encrypted home-agent control channel with
  a read-only `pipeline.list` action. The response separates shipped presets,
  custom files, and load errors; the Worker/DO never see the decrypted catalog.
- Stage fields: `id`, `title`, `phase`, `agent`, `role`, `instructions`,
  `evidence`, `when`, `gate`.
- Phases: `contract`, `work`, `review`, `close`.
- Evidence types: `string`, `number`, `boolean`, `object`, `array`; flags:
  `required`, `immutable`.
- Conditions support one operator: `equals`, `notEquals`, `in`, `notIn`, or
  `exists`, evaluated against evidence from earlier stages.
- Template variables: `request.*`, `workspace.*`, `pipeline.*`, and `stage.*`.
- Requests store `pipeline_id`, `pipeline_version`, `pipeline_hash`,
  `pipeline_snapshot`, and `current_stage_id`.
- Stage evidence lives in `evidence`; progress lives in `progress`; stage gates
  live in `stage_gates`.
- Tools: `clara_stage_done`, `clara_stage_gate`, `clara_progress`,
  `clara_criteria`, `clara_ask`, `clara_inbox`, `clara_approve`, `clara_gate`,
  `clara_resolve`, `clara_tick`.
- The daemon never reads a workspace pipeline file; only the plugin loader and
  CLI do.

</details>
