# Clara Lab

## Summary

Clara Lab is a developer console for the engine, opened from Clara Desktop at
`/lab`. The desktop window is only the UI. The lab service runs on the engine
host, next to the engine, and the desktop reaches it through the hub's
authenticated bridge. The service owns the workspace files, compiles a
workspace's packages so authors can inspect every resolved step, and acts as the
MCP harness so they can drive the same run by hand. It is for people writing
custom pipelines, not for end users.

The workspace is local to the lab service, not the desktop. The standard
packages come from the engine, so the preview and a run cannot drift. The UI is
desktop-only: the deployed web/PWA build contains no lab code.

## User flow

1. Start the lab service with `clara start lab`, or run `pnpm dev:lab` while
   editing it. The service opens on `127.0.0.1:8791` in a full-height workbench
   with one navigation rail: **Review**, **Runs**, **Traffic**, **Console**, and
   **Settings**. In Clara Desktop, open **Clara Lab** from the sidebar to use the
   same UI at `/lab` through the hub bridge.
2. Open **Settings**, choose **Files on this machine** — the repository as the
   lab sees it. Use **Browse…** to pick the folder or type the path. The
   engine's own workspace is reported by the service and shown read-only
   beside it. This is the only place setup and adapter controls live.
3. Press **Run setup check**. The lab reports whether it can compile the host
   path, whether the engine can read its reported path, and whether a
   strict pipeline has a live adapter. The status bar carries only the resulting
   problem state.
4. On **Review**, choose a pipeline. The compiled tree shows every step, route,
   `provider/model`, policy, budget, and source file. Diagnostics sit above the
   tree so errors and warnings are the first thing you see. The Inspector's
   **Inputs** tab shows each declared input with its resolved step path, the
   artifacts the step may read, and whether the original request is included.
   **Compare run** opens the pinned-snapshot diff without hiding it in an
   accordion.
5. Press **Run this pipeline** to open the **Debug** dock at the bottom of
   Review. The dock carries the pipeline and the engine-reported
   workspace. Start a run there; the lab selects it and claims the first work
   order.
6. Step through the run in the Debug dock. It shows one clear current-step card:
   the exact step, a result box, and a single primary action. Type the result
   and press **Complete and continue** (or **Choose route** for a router). The
   next step is claimed automatically unless **Pause after each step** is on.
7. Use the dock header to switch between recent debug runs, **Pull next**,
   **Cancel run**, and open a run in **Runs**. The dock opens collapsed by
   default and only resumes an active debug run; otherwise it shows the
   start-a-run state. Heartbeat controls stay with the active debug claim.
8. Open **Runs** for observation. Owned runs are listed by default and debug
   runs are hidden behind a persisted **Show debug runs** toggle. The page never
   starts or steps a run. **Cancel run** stops the selected run; **Kill all
   runs** cancels every non-terminal root run after confirmation, including
   debug runs hidden by the toggle.
9. Follow run progress in the read-only step tree, the per-run events, and the
   traffic log. Selecting a step opens collapsed Prompt, Result, Inputs, and
   Policy/limits/raw sections. Prompt toggles between rendered Markdown and raw
   text; Result toggles between Markdown, pretty JSON, and raw text. Inputs
   lists every declared input with its source path, status, and result. The
   selected run header totals tokens and tool calls across all of its steps.
10. Open **Console** to call the engine MCP surface directly. It renders a
    form from each tool's input schema with required, range, and enum hints
    under every field, keeps the raw JSON editor behind a Form/JSON toggle, and
    loads recent calls back into the form.
11. Run `clara status lab --check` in CI to compile a target and fail on errors.
    Model diagnostics stay static: missing providers, missing models, and unset
    models are reported without reading a live catalog.

## Desktop and remote

The lab has three parts, and only the first is a window:

1. **The desktop UI.** Clara Desktop compiles the lab UI into its own build and
   opens it at `/lab`. The deployed web/PWA build contains no lab code: the
   route is not registered, Vite replaces the lab modules with stubs, and the
   bundle check fails if a lab chunk reaches the web artifact. The route mounts
   the lab in a flex slot under its own app bar and marks it `data-embedded`, so
   the workbench fills that slot rather than the viewport; only the standalone
   `tools/lab` entry keeps the viewport height.
2. **The lab service.** `@clara/lab-server` runs next to the engine, not on the
   desktop and not inside the hub process. It owns the workspace files, the
   preview and import graph, the engine token, run and admin calls over MCP and
   SSE, and the engine std/default asset cache.
3. **The hub bridge.** The hub exposes an authenticated bridge at `/v1/lab/*`
   and forwards it to the lab service's `/api/*`. This is how a remote desktop
   reaches a lab service on the engine host. The hub does not hold the engine
   token; it adds only the shared bridge token.

Point the hub at the service with `CLARA_LAB_URL` (default
`http://127.0.0.1:8791`) and `CLARA_LAB_TOKEN`. On the lab host, bind with
`CLARA_LAB_HOST` and set `CLARA_LAB_ALLOW_REMOTE=1` when the hub is remote. Keep
the lab service on a private network or behind a firewall; it is not meant to be
exposed publicly.

The preview uses the engine's own standard packages. Before a preview, the lab
caches the exact std/default bundle by hash from the engine's token-protected,
read-only `GET /v1/packages/assets`, so a preview never compiles against a copy
bundled with the lab. Deploying new custom pipelines from the lab is planned and
not implemented; the lab previews the workspace it is pointed at and does not
publish packages to the engine.

## Core business rules

1. **Preview runs on the lab service; probe is remote.** Preview uses the same
   loader and compiler as the service against the lab service's workspace files.
   Probe talks to the running engine over MCP and SSE.
2. **One host path, one reported workspace.** Preview needs the lab host path;
   the service reports its own path from `CLARA_ENGINE_WORKSPACE`
   (default: its working directory) over `GET /v1/config`. Settings keeps the
   host path editable and shows the service path read-only, and the Review debug
   dock always uses the reported path. The Lab is also the supported place to
   choose a pipeline target; model-facing `clara_start` always uses the active
   config's entry.
3. **Setup has one home.** Workspace selection, reconnect, adapter registration,
   model status, and preflight results live only in **Settings**. The status bar
   reports failures and setup issues, but healthy state stays quiet. No view
   duplicates the setup controls.
4. **The lab impersonates the harness.** It uses the MCP work-order surface with
   a work token, and the operator REST endpoints for target selection and
   preflight. It does not call a model, create an agent session, or enforce real
   policy.
5. **The engine token never reaches the desktop.** The lab service keeps it and
   calls the engine directly. The hub bridge carries only the shared lab token,
   and the desktop sees only `/v1/lab` responses.
6. **Auto-pull is the default.** After a response the next ready step is claimed
   automatically. **Pause after each step** turns the run into a manual
   step-through.
7. **Heartbeats are automatic.** The lab renews the lease every ten seconds so a
   slow author does not lose the step. Pausing heartbeats is an advanced control
   for testing the watchdog.
8. **Strict pipelines self-register the lab adapter.** Starting a strict target
   registers `clara-lab` once and retries. The adapter is for orchestration
   testing, not real enforcement.
9. **Files are local to the lab service.** The workspace belongs to the machine
   that runs the lab service, not the desktop. Files are edited outside the
   browser; the lab is a viewer and a probe and never writes YAML, Markdown, or
   agent prompts. The preview watches the source files and reloads.
10. **Pinned data is Lab-only.** The engine returns run summaries to MCP
    and REST callers without the pinned tree or full step rows. The lab reads
    `GET /v1/runs/:id/snapshot` and `GET /v1/runs/:id/steps/:path` directly with
    the engine token. The browser sees only the derived step count and the
    step detail it asks for.
11. **Model diagnostics are static.** The preview reports
    `model_provider_missing`, `model_missing`, and `model_unset` from the
    compiled step fields. It does not read a live model catalog, so it cannot
    report whether a named model exists or is enabled.
12. **The lab shows the raw work order.** The step card shows `order.prompt`,
    its declared inputs and artifacts, and the background request separately.
    The preview shows the resolved `inputs` and `artifacts` wiring and warns
    with `inputs_missing` when a step with prior siblings declares none. The
    harness adapter composes the step prompt, declared inputs, artifacts, and
    the background request into the managed worker prompt.
13. **Review owns the debug loop.** Starting, pausing, pulling, completing,
    routing, spawning, and heartbeat controls live in the Debug dock on
    **Review**. **Runs** never starts or steps a run.
14. **Runs is observation-first.** **Runs** shows owned runs by default and hides
    debug runs behind a persisted **Show debug runs** toggle. The active count
    includes hidden debug runs, and the empty state explains how to reveal them.
    Hidden debug runs carry a **debug** badge when shown. The selected run
    header totals tokens and tool calls across every step, whether or not the
    run is still active.
15. **Ownership is visible.** Runs started by the lab carry
    `origin_harness: "clara-lab"`; runs started by a harness carry their own
    origin and session. The Debug dock only steps lab-origin runs. A run with no
    recorded origin is treated as external, never as a debug run.
16. **Runs are recoverable in one action.** **Cancel run** sits on the selected
    run header; **Kill all runs** cancels every non-terminal root run after a
    confirmation, including debug runs hidden by the toggle. Both are
    front-and-center, not inside advanced controls.
17. **Console forms follow the schema.** The console derives one control per
    top-level argument and recurses into nested objects. Required fields are
    marked, and range, length, item-count, and enum constraints are shown under
    each input. Blank optional fields are omitted from the payload. Opaque
    arguments fall back to a JSON field, and the raw JSON editor stays available
    from the Form/JSON toggle. Unknown keys typed in JSON are dropped, with a
    warning, when switching back to the form.
18. **Standard packages come from the engine.** Before a preview, the lab caches
    the exact std/default bundle by hash from the engine's read-only
    `GET /v1/packages/assets`. It never compiles against a copy bundled with the
    lab, so a preview and a run cannot drift.
19. **The UI is desktop-only.** Clara Desktop opens the lab at `/lab`; the
    deployed web/PWA build contains no lab code. The desktop is the UI, the lab
    service runs on the engine host, and the hub is the bridge.

## Edge cases

- The host path compiles but the engine reports a path it cannot read:
  Settings shows “Engine workspace: Needs attention” and the status bar
  points there; set `CLARA_ENGINE_WORKSPACE` on the service to its
  mounted workspace.
- The engine is offline or has not reported a workspace yet: preview
  still works; Settings shows “Waiting for the engine…” and the run
  actions retry once the service reports its path.
- A worker step has no model: `model_unset` warns that the harness default will
  be used instead of the pipeline model.
- A worker step names a provider without a model: `model_missing` warns that the
  provider is ignored.
- No token is present: Settings and the status bar show the problem; start the
  service or set `CLARA_ENGINE_TOKEN`.
- The engine rejects the token: Settings shows the token hint; restart the
  lab with the service's token.
- The engine's std/default bundle cannot be fetched: preview still compiles the
  workspace's own packages, but the run may use a different bundle. Check the
  engine token and the engine's `GET /v1/packages/assets`.
- A strict target has no adapter: the run registers one automatically; the
  adapter status changes to live in Settings on the next check.
- There are no active runs: **Kill all runs** stays disabled, and no empty
  confirmation is shown.
- Runs has no owned runs but hidden debug runs exist: the empty state says so and
  offers **Show debug runs** instead of looking broken.
- The debug toggle is turned off while a debug run is selected: the page selects
  the first visible owned run, or shows the hidden-debug empty state.
- A debug run is opened in Runs: the page turns the debug toggle on first, then
  selects it.
- **Kill all runs** runs while debug runs are hidden: the confirmation names how
  many hidden debug runs it will also cancel.
- **Continue on Review** is pressed on a debug run: Review opens the Debug dock,
  selects that run, and expands the dock.
- Review opens with no debug run in flight: the Debug dock stays collapsed and
  shows the start-a-run state instead of the most recent cancelled or failed
  run. An active debug run is selected automatically.
- A debug run finishes: the dock keeps the completed run selected so it can be
  compared or opened in Runs; the next start replaces it.
- Traffic is dominated by adapter heartbeats: the call list hides heartbeats by
  default and can show them again with the toggle.
- A lab server restarts: in-memory work tokens are lost. The watchdog retries the
  step after the stall threshold.
- The hub cannot reach the lab service: the desktop reports that the lab server
  is unavailable through the hub. Check `CLARA_LAB_URL`, the shared
  `CLARA_LAB_TOKEN`, and that the service is listening on `CLARA_LAB_HOST`.
- Auto-heartbeat is paused: a slow response can outlive the stall threshold and
  be retried. This is deliberate for testing.
- A file changes during a run: the pinned snapshot stays authoritative and the
  comparison view shows the difference.
- The selected target is the package entry: it is a router; the run starts with a
  route choice instead of an agent step.
- Several work orders are claimed at once: the first is marked **current**, the
  rest remain available below it.

## Out of scope

- Calling a model, starting a harness session, or spawning processes.
- Real policy enforcement. The lab adapter deliberately does not enforce tool,
  path, shell, turn, or token rules.
- Editing pipelines, prompts, or policies in the browser.
- Public exposure. The lab service stays on a private network or loopback behind
  the hub bridge; it is not a public service.
- Deploying new custom pipelines to the engine. The lab previews the workspace it
  is pointed at; publishing packages is not implemented.
- A visual pipeline editor or a graph-layout canvas.
- Rewinding a run to an earlier state.
- Starting, pulling, completing, routing, or spawning a run from **Runs**. The
  page is observation-first; those controls live in the Review Debug dock.
- Monitoring harness sessions; the hub panel owns the cross-harness Sessions
  view.

## Known gaps

- The lab trusts the workspace reported by the engine. It does not verify
  that the host path and the service mount point at the same files.
- Preview compiles the host files. If the engine has a different mount,
  the run can use different content until the two paths are aligned.
- Only root-package imports are directly selectable as targets. Nested imports
  are visible in the package list but must be reached through their parent.
- Source view is capped at 512 KB per file.
- Runs started through the Console without an explicit origin, and runs created
  before origin tracking, are treated as external and never appear in the Debug
  dock.
- The Debug dock keeps one selected debug run at a time. It lists recent debug
  runs in a picker but has no multi-run split view.
- Scripted or recorded response playback is not implemented; every response is
  entered by hand or sent through the tool console.
- The Console form handles strings, numbers, booleans, string enums, arrays of
  strings, and nested objects. Other schema shapes (unions, references, arrays of
  objects) fall back to a JSON field, and the raw schema stays available under
  **Input schema**.
- Deploying a workspace's packages to the engine is not implemented. The lab
  previews and probes; it does not publish custom pipelines.

## Technical appendix

<details>
<summary>Commands, routes, data, and packages</summary>

- Start: `clara start lab` (serve), `clara status lab --check` (validate). Clara
  Desktop opens the same UI at `/lab` through the hub bridge.
- Dev: `pnpm dev:lab` runs Vite on `5175` and the lab server on `8791`.
- Default ports: lab `8791`, engine `8789`.
- Environment (lab service): `CLARA_LAB_PORT`, `CLARA_LAB_OPEN=0`,
  `CLARA_LAB_HOST` (bind address), `CLARA_LAB_TOKEN` (shared bridge token),
  `CLARA_LAB_ALLOW_REMOTE=1` (accept a remote bridge instead of loopback only),
  `CLARA_ENGINE_URL`, `CLARA_ENGINE_TOKEN`, `CLARA_ENGINE_TOKEN_FILE`,
  `CLARA_ENGINE_WORKSPACE` (the service workspace, also the lab host default),
  `CLARA_ENGINE_CONFIG`, and `CLARA_ENGINE_AUTOSTART`.
- Environment (hub): `CLARA_LAB_URL` (lab service target, default
  `http://127.0.0.1:8791`, `off` disables the bridge) and `CLARA_LAB_TOKEN`
  (must match the lab service). The hub holds no engine token.
- Hub bridge: `ALL /v1/lab/*` maps to the lab service's `/api/*` on the same
  path and query. It is device-authenticated like every `/v1` call, forwards
  only `accept`, `content-type`, `x-clara-lab`, and `user-agent`, adds
  `Authorization: Bearer <CLARA_LAB_TOKEN>`, rewrites `Origin` to the lab's own
  origin, caps request bodies at 16 MiB, and returns `503 lab_unavailable` when
  the service is unreachable or `400 invalid_path` for a path outside `/api`.
- Lab service routes (reached directly at `/api/*` or through `/v1/lab/*`):
  `GET /api/health`, `GET /api/state`, `GET /api/stream`, `POST /api/preview`,
  `POST /api/preflight`, `POST /api/pick-directory`, `POST /api/diff`,
  `POST /api/tools/:name`, `GET /api/runs`, `GET /api/runs/:id`,
  `POST /api/runs/cancel-all`, `GET /api/inbox`, `GET /api/source`,
  `POST /api/heartbeat`, `POST /api/reconnect`, `POST /api/adapter/register`,
  `POST /api/adapter/remove`, `POST /api/violation`.
- Engine assets: `GET /v1/packages/assets` on the engine returns
  `{ hash, version, files }`. The lab caches the bundle under
  `CLARA_CACHE_DIR/lab/assets/<hash>` (default
  `~/.cache/clara/lab/assets/<hash>`) and points the preview loader at it with
  `CLARA_ENGINE_ASSETS_DIR`.
- `/api/preflight` returns `{ host, runtime, adapter }`: host compile status and
  package count, engine catalog visibility of its reported workspace, and
  whether the target is strict and has a live adapter.
- `/api/runs/cancel-all` cancels every non-terminal root run and returns
  `{ cancelled, failed }`.
- `/api/pick-directory` opens the lab host's native folder chooser and returns
  `{ path }` or `{ path: null }` when cancelled. It falls back to manual entry
  when no desktop dialog is available.
- Model diagnostics are static: `model_provider_missing` (error),
  `model_missing` (warning), and `model_unset` (warning).
- The lab multiplexes MCP traffic and engine events on `/api/stream`;
  the server resumes `/v1/events` with its last event id.
- SSE event data carries `run_id`, `event_id`, and `created_at` alongside the
  step payload so subscribers can attribute events to a run.
- Setup, tab, pause-after-step, and **Show debug runs** choices persist under
  `clara-lab.settings.v1` in local storage. The engine token is never
  stored there.
- Debug runs are runs with `origin_harness: "clara-lab"`. The Debug dock starts
  them with origin `{ harness: "clara-lab", agent: "lab", kind: "agent" }` and
  selects them by ID; **Runs** filters the same origin client-side. On load the
  dock resumes only the newest active debug run; terminal runs stay pickable.
- SDK package: `@clara/pipeline-preview` exports `resolveWorkspace`, `previewPipeline`,
  `listTargets`, `describePackages`, `collectSources`, `diagnoseCompiled`,
  `diagnoseCatalog`, `diffCompiled`, and `inspectSnapshot`.
- UI package: `packages/lab` (`@clara/lab`); lab service package:
  `packages/lab-server` (`@clara/lab-server`); preview SDK: `packages/preview`
  (`@clara/pipeline-preview`); standalone CLI and UI entry: `tools/lab`
  (`@clara/lab-cli`, the `clara-lab` bin) with the browser entry under
  `tools/lab/src`. The desktop mounts `@clara/lab` from
  `apps/web/src/pages/lab-page.tsx`; the hub bridge is
  `apps/hub/server/src/api/routes/lab.ts`.
- Related docs: [orchestration.md](orchestration.md),
  [capabilities.md](capabilities.md).

</details>
