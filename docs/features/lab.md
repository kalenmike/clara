# Clara Lab

## Summary

Clara Lab is a loopback developer console for the orchestrator. It compiles a
workspace's packages so authors can inspect every resolved step, then acts as
the MCP harness so they can drive the same run by hand. It is for people
writing custom pipelines, not for end users.

## User flow

1. Start the lab with `pnpm clara lab`, or run `pnpm dev:lab` while editing it.
   The lab opens on `127.0.0.1:8791` in a full-height workbench with one
   navigation rail: **Review**, **Runs**, **Traffic**, **Console**,
   **Sessions**, and **Settings**.
2. Open **Settings**, choose **Files on this machine** — the repository as the
   lab sees it. Use **Browse…** to pick the folder or type the path. The
   orchestrator's own workspace is reported by the service and shown read-only
   beside it. This is the only place setup and adapter controls live.
3. Press **Run setup check**. The lab reports whether it can compile the host
   path, whether the orchestrator can read its reported path, whether a strict
   pipeline has a live adapter, and whether OpenCode's model catalog is
   available. The status bar carries only the resulting problem state.
4. On **Review**, choose a pipeline. The compiled tree shows every step, route,
   `provider/model`, policy, budget, and source file. Diagnostics sit above the
   tree so errors and warnings are the first thing you see. **Compare run** opens
   the pinned-snapshot diff without hiding it in an accordion.
5. Press **Run this pipeline**. The Runs view carries the pipeline and the
   orchestrator-reported workspace.
6. Start a run from the always-visible composer at the top of **Runs**. The lab
   claims the first work order and shows one clear current-step card: the exact
   task, a result box, and a single primary action.
7. Type the result and press **Complete and continue** (or **Choose route** for a
   router). The next step is claimed automatically unless **Pause after each
   step** is on.
8. Manage runs from the header: **Cancel run** is on the selected run and
   **Kill all runs** cancels every non-terminal root run after confirmation.
   Follow progress in the step tree, the per-run events, and the traffic log.
9. Open **Console** to call the orchestrator MCP surface directly. It is a
   first-class view, not a hidden tab, and recent calls can be loaded back into
   the runner.
10. Open **Sessions** to see the OpenCode sessions the lab has observed: title,
    agent, directory, running state, last seen, and event count.
11. Run `pnpm clara lab check` in CI to compile a target and fail on errors.
    When OpenCode is reachable it also checks that the configured models exist;
    offline it falls back to static provider/model validation.

## Core business rules

1. **Preview is local; probe is remote.** Preview uses the same loader and
   compiler as the service against the host files. Probe talks to the running
   orchestrator over MCP and SSE.
2. **One host path, one reported workspace.** Preview needs the local host path;
   the service reports its own path from `CLARA_ORCHESTRATION_WORKSPACE`
   (default: its working directory) over `GET /v1/config`. Settings keeps the
   host path editable and shows the service path read-only, and the Runs view
   always uses the reported path.
3. **Setup has one home.** Workspace selection, reconnect, adapter registration,
   model status, and preflight results live only in **Settings**. The status bar
   reports failures and setup issues, but healthy state stays quiet. No view
   duplicates the setup controls.
4. **The lab impersonates the harness.** It is an MCP client with a work token.
   It does not call a model, create an agent session, or enforce real policy.
5. **The orchestrator token never reaches the browser.** The lab server keeps it
   and every browser request stays on the same loopback origin.
6. **Auto-pull is the default.** After a response the next ready step is claimed
   automatically. **Pause after each step** turns the run into a manual
   step-through.
7. **Heartbeats are automatic.** The lab renews the lease every ten seconds so a
   slow author does not lose the step. Pausing heartbeats is an advanced control
   for testing the watchdog.
8. **Strict pipelines self-register the lab adapter.** Starting a strict target
   registers `clara-lab` once and retries. The adapter is for orchestration
   testing, not real enforcement.
9. **Files are edited outside the browser.** The lab is a viewer and a probe; it
   never writes YAML, Markdown, or task prompts. The preview watches the source
   files and reloads.
10. **Pinned data is Lab-only.** The orchestrator returns run summaries to MCP
    and REST callers without the pinned tree or full step rows. The lab reads
    `GET /v1/runs/:id/snapshot` and `GET /v1/runs/:id/steps/:path` directly with
    the orchestrator token. The browser sees only the derived task count and the
    step detail it asks for.
11. **Models are validated against OpenCode.** The lab reads the running
    OpenCode model catalog and reports `model_provider_missing`,
    `model_missing`, `model_unset`, `model_unknown`, and `model_disabled`.
    When OpenCode is offline the preview still compiles; model existence is
    shown as unchecked instead of failing the setup.
12. **The lab shows the raw work order.** The step card shows `order.prompt` and
    its `context` separately. The OpenCode adapter composes the step prompt, root
    request, and prior results into the managed worker prompt.
13. **Runs are recoverable in one action.** **Cancel run** sits on the selected
    run header; **Kill all runs** cancels every non-terminal root run after a
    confirmation. Both are front-and-center, not inside advanced controls.
14. **OpenCode sessions are observed, not driven.** The lab server subscribes to
    OpenCode `/api/event`, tracks the last event per session, and merges that
    with session metadata (`title`, `agent`, `location.directory`,
    `time.updated`) from the session list and lookup endpoints. Phase one is
    read-only and OpenCode-only.

## Edge cases

- The host path compiles but the orchestrator reports a path it cannot read:
  Settings shows “Orchestrator workspace: Needs attention” and the status bar
  points there; set `CLARA_ORCHESTRATION_WORKSPACE` on the service to its
  mounted workspace.
- The orchestrator is offline or has not reported a workspace yet: preview
  still works; Settings shows “Waiting for the orchestrator…” and the run
  actions retry once the service reports its path.
- OpenCode is offline: preview still compiles and checks provider/model pairing;
  the models row says model existence is unchecked, and Sessions explains how to
  reconnect.
- OpenCode's event stream drops: Sessions keeps the last known rows and retries;
  the status bar shows `reconnecting`.
- A session is idle and emits no events after the lab starts: it still appears
  from the session list, with the list's `time.updated` as its fallback last-seen
  time.
- A model exists under a different provider: the diagnostic names the providers
  that do have it.
- A worker step has no model: `model_unset` warns that the harness default will
  be used instead of the pipeline model.
- No token is present: Settings and the status bar show the problem; start the
  service or set `CLARA_ORCHESTRATION_TOKEN`.
- The orchestrator rejects the token: Settings shows the token hint; restart the
  lab with the service's token.
- The container's standard packages are stale: the host check passes but the run
  fails with a missing `lib/std` package; rebuild the image or fix
  `CLARA_STD_DIR`.
- A strict target has no adapter: the run registers one automatically; the
  adapter status changes to live in Settings on the next check.
- There are no active runs: **Kill all runs** stays disabled, and no empty
  confirmation is shown.
- Traffic is dominated by adapter heartbeats: the call list hides heartbeats by
  default and can show them again with the toggle.
- A lab server restarts: in-memory work tokens are lost. The watchdog retries the
  step after the stall threshold.
- Auto-heartbeat is paused: a slow response can outlive the stall threshold and
  be retried. This is deliberate for testing.
- A file changes during a run: the pinned snapshot stays authoritative and the
  comparison view shows the difference.
- The selected target is the package entry: it is a router; the run starts with a
  route choice instead of a task.
- Several work orders are claimed at once: the first is marked **current**, the
  rest remain available below it.

## Out of scope

- Calling a model, starting an OpenCode session, or spawning processes.
- Real policy enforcement. The lab adapter deliberately does not enforce tool,
  path, shell, turn, or token rules.
- Editing pipelines, prompts, or policies in the browser.
- Remote access. The lab binds loopback only.
- A visual pipeline editor or a graph-layout canvas.
- Rewinding a run to an earlier state.
- Cancelling, archiving, or moving an OpenCode session from the Sessions view.
  Phase one is a read-only observation surface.

## Known gaps

- The lab trusts the workspace reported by the orchestrator. It does not verify
  that the host path and the service mount point at the same files.
- Preview compiles the host files. If the orchestrator has a different mount,
  the run can use different content until the two paths are aligned.
- Only root-package imports are directly selectable as targets. Nested imports
  are visible in the package list but must be reached through their parent.
- Source view is capped at 512 KB per file.
- Sessions are listed from the newest 100 OpenCode records plus any sessions seen
  on the live event stream; there is no pagination yet.
- The Sessions view is OpenCode-only. Orchestrator adapters and run ownership
  are shown in Settings and Runs, not merged into the session table.
- Scripted or recorded response playback is not implemented; every response is
  entered by hand or sent through the tool console.

## Technical appendix

<details>
<summary>Commands, routes, data, and packages</summary>

- Start: `pnpm clara lab` (serve), `pnpm clara lab check` (validate).
- Dev: `pnpm dev:lab` runs Vite on `5175` and the lab server on `8791`.
- Default ports: lab `8791`, orchestrator `8789`.
- Environment: `CLARA_LAB_PORT`, `CLARA_LAB_OPEN=0`,
  `CLARA_ORCHESTRATION_URL`, `CLARA_ORCHESTRATION_TOKEN`,
  `CLARA_ORCHESTRATION_TOKEN_FILE`, `CLARA_ORCHESTRATION_WORKSPACE`
  (the service workspace, also the lab host default),
  `CLARA_ORCHESTRATION_CONFIG`, `CLARA_STD_DIR`,
  `CLARA_ORCHESTRATION_AUTOSTART`, `CLARA_OPENCODE_URL`,
  `CLARA_OPENCODE_PASSWORD`. The lab also reads
  `${XDG_STATE_HOME:-~/.local/state}/opencode/service.json` when the OpenCode
  variables are unset.
- Lab routes: `GET /api/health`, `GET /api/state`, `GET /api/stream`,
  `POST /api/preview`, `POST /api/preflight`, `POST /api/pick-directory`,
  `POST /api/diff`, `POST /api/tools/:name`, `GET /api/runs`,
  `GET /api/runs/:id`, `POST /api/runs/cancel-all`, `GET /api/inbox`,
  `GET /api/opencode/sessions`, `GET /api/source`,
  `POST /api/heartbeat`, `POST /api/reconnect`,
  `POST /api/adapter/register`, `POST /api/adapter/remove`,
  `POST /api/violation`.
- `/api/preflight` returns `{ host, runtime, adapter, models }`: host compile
  status and package count, orchestrator catalog visibility of its reported
  workspace, whether the target is strict and has a live adapter, and the
  OpenCode model catalog status.
- `/api/opencode/sessions` returns the observer summary plus rows with
  `id`, `title`, `agent`, `directory`, `parentID`, `model`, `running`,
  `lastSeenAt`, `lastSeenSource`, `eventCount`, and `lastEventType`.
- `/api/runs/cancel-all` cancels every non-terminal root run and returns
  `{ cancelled, failed }`.
- The OpenCode observer keeps the password server-side. It subscribes to
  `/api/event`, seeds idle sessions from the session list, and uses
  `session.active()` for the running marker.
- `/api/pick-directory` opens the lab host's native folder chooser and returns
  `{ path }` or `{ path: null }` when cancelled. It falls back to manual entry
  when no desktop dialog is available.
- Model diagnostics: `model_provider_missing` (error), `model_missing`
  (warning), `model_unset` (warning), `model_unknown` (error), and
  `model_disabled` (warning).
- The lab multiplexes MCP traffic and orchestrator events on `/api/stream`;
  the server resumes `/v1/events` with its last event id.
- SSE event data carries `run_id`, `event_id`, and `created_at` alongside the
  step payload so subscribers can attribute events to a run.
- Setup and tab choices persist under `clara-lab.settings.v1` in local storage.
  The orchestrator token is never stored there.
- SDK package: `@clara/devtools` exports `resolveWorkspace`, `previewPipeline`,
  `listTargets`, `describePackages`, `collectSources`, `diagnoseCompiled`,
  `diagnoseCatalog`, `diffCompiled`, and `inspectSnapshot`.
- Lab app: `apps/lab`; package: `packages/devtools`; browser UI under
  `apps/lab/src`; server under `apps/lab/server`.
- Related docs: [orchestration.md](orchestration.md),
  [capabilities.md](capabilities.md).

</details>
