# Clara Lab

## Summary

Clara Lab is a loopback developer console for the orchestrator. It compiles a
workspace's packages so authors can inspect every resolved step, then acts as
the MCP harness so they can drive the same run by hand. It is for people
writing custom pipelines, not for end users.

## User flow

1. Start the lab with `pnpm clara lab`, or run `pnpm dev:lab` while editing it.
   The lab opens on `127.0.0.1:8791`.
2. The Preview tab loads the workspace catalog and the package entry. Choose a
   target such as `std:software/feature` or a local pipeline.
3. Inspect the compiled tree. Select a step to see its rendered prompt, effective
   policy, budget, routes, source file, and raw JSON.
4. Read the diagnostics. Fix compile errors and author warnings in the source
   files; the lab watches the package and reloads the preview.
5. Select **Use in probe**, then start a run with a prompt. The Runs tab shows the
   first work order exactly as an agent receives it.
6. Type the result, optionally report usage, and press **Complete**. Use
   **Fail**, **Route**, or **Spawn** to exercise the other transitions.
7. Follow the run in the step tree and the event log, or turn off
   auto-heartbeat to test the watchdog. Both **Watchdog tick** and **Cancel run**
   are available on the toolbar.
8. Expand **Compare with a pinned run** to see what changed between the current
   files and the snapshot an existing run started with.
9. Run `pnpm clara lab check` in CI to compile a target and fail on errors.

## Core business rules

1. **Preview is local; probe is remote.** Preview uses the same loader and
   compiler as the service against the files on disk. Probe talks to the running
   orchestrator over MCP and SSE.
2. **The lab impersonates the harness.** It is an MCP client with a work token.
   It does not call a model, create an agent session, or enforce real policy.
3. **The orchestrator token never reaches the browser.** The lab server keeps it
   and every browser request stays on the same loopback origin.
4. **Previewing creates no run.** Nothing is pinned until a run starts; editing
   files is safe while the Preview tab is open.
5. **Work tokens belong to the lab process.** The server stores claimed orders,
   auto-heartbeats them every ten seconds, and drops orders when a step retries,
   finishes, fails, or is cancelled.
6. **Manual step mode is the default.** After a response the next order is only
   claimed with **Pull next** unless **Auto-pull next** is on.
7. **Strict targets fail closed.** Register the lab adapter before starting a
   strict pipeline. The adapter is for orchestration testing, not real
   enforcement.
8. **Files are edited outside the browser.** The lab is a viewer and a probe;
   it never writes YAML, Markdown, or task prompts.

## Edge cases

- The orchestrator is offline: Preview still works; probe actions wait and retry
  when the service returns.
- No token is present: the lab shows a banner and asks for
  `pnpm clara orchestration start` or `CLARA_ORCHESTRATION_TOKEN`.
- The workspace has no `orchestration/index.yml`: preview returns a
  `config_missing` diagnostic instead of guessing a pipeline.
- A target does not compile: the tree is replaced by the compiler diagnostic and
  its source path.
- A lab server restarts: in-memory work tokens are lost. The watchdog retries the
  step after the stall threshold, and the old token is no longer usable.
- Auto-heartbeat is off: a slow response can outlive the stall threshold and be
  retried by the watchdog. This is deliberate for testing.
- A strict target starts without an adapter: the service refuses it with
  `enforcement_unavailable`.
- A file changes during a run: the pinned snapshot stays authoritative and the
  comparison view shows the difference.
- A diagnostic points at a file outside the preview's source set: the source
  endpoint refuses it with `403`.
- A spawned child run fails: the parent step fails fast and its alert appears in
  the run's alert list.

## Out of scope

- Calling a model, starting an OpenCode session, or spawning processes.
- Real policy enforcement. The lab adapter deliberately does not enforce tool,
  path, shell, turn, or token rules.
- Editing pipelines, prompts, or policies in the browser.
- Remote access. The lab binds loopback only.
- A visual pipeline editor or a graph-layout canvas.
- Rewinding a run to an earlier state.

## Known gaps

- Preview compiles the files on the lab host. If the orchestrator runs in a
  container with a different workspace mount, preview and probe can disagree.
- Only root-package imports are directly selectable as targets. Nested imports
  are visible in the package list but must be reached through their parent.
- Source view is capped at 512 KB per file.
- Scripted or recorded response playback is not implemented; every response is
  entered by hand or sent through the raw tool console.

## Technical appendix

<details>
<summary>Commands, routes, data, and packages</summary>

- Start: `pnpm clara lab` (serve), `pnpm clara lab check` (validate).
- Dev: `pnpm dev:lab` runs Vite on `5175` and the lab server on `8791`.
- Default ports: lab `8791`, orchestrator `8789`.
- Environment: `CLARA_LAB_PORT`, `CLARA_LAB_OPEN=0`,
  `CLARA_ORCHESTRATION_URL`, `CLARA_ORCHESTRATION_TOKEN`,
  `CLARA_ORCHESTRATION_TOKEN_FILE`, `CLARA_ORCHESTRATION_WORKSPACE`,
  `CLARA_ORCHESTRATION_CONFIG`, `CLARA_STD_DIR`,
  `CLARA_ORCHESTRATION_AUTOSTART`.
- Lab routes: `GET /api/health`, `GET /api/state`, `GET /api/stream`,
  `POST /api/preview`, `POST /api/diff`, `POST /api/tools/:name`,
  `GET /api/runs`, `GET /api/runs/:id`, `GET /api/inbox`, `GET /api/source`,
  `POST /api/heartbeat`, `POST /api/reconnect`,
  `POST /api/adapter/register`, `POST /api/adapter/remove`,
  `POST /api/violation`.
- The lab multiplexes MCP traffic and orchestrator events on `/api/stream`;
  the server resumes `/v1/events` with its last event id.
- SSE event data now carries `run_id`, `event_id`, and `created_at` alongside the
  step payload so subscribers can attribute events to a run.
- SDK package: `@clara/devtools` exports `resolveWorkspace`, `previewPipeline`,
  `listTargets`, `describePackages`, `collectSources`, `diagnoseCompiled`,
  `diagnoseCatalog`, `diffCompiled`, and `inspectSnapshot`.
- Lab app: `apps/lab`; package: `packages/devtools`; browser UI under
  `apps/lab/src`; server under `apps/lab/server`.
- Related docs: [orchestration.md](orchestration.md),
  [capabilities.md](capabilities.md).

</details>
