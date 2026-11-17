---
title: Clara Lab
---

# Clara Lab

## Summary

Clara Lab is a developer console for orchestration packages. The desktop window
is only the UI: the lab service runs on the engine host, next to the engine, and
the desktop reaches it through the hub's authenticated bridge. It compiles a
workspace so authors can inspect every resolved step and drives a run by hand.
It is for people writing custom pipelines, not an end-user surface.

## User flow

1. `clara start` supervises the lab service with the rest of the stack; use
   `clara start lab` for only it. In Clara Desktop, open **Clara Lab** at `/lab`;
   a checkout can also run `pnpm dev:lab` or `clara-dev start lab` for the
   standalone workbench on `127.0.0.1:8791`.
2. In **Settings**, choose **Files on this machine** and pick the repository as
   the lab sees it. The engine's reported workspace is shown read-only beside it,
   and **Run setup check** reports whether the host path compiles, whether the
   engine can read its path, and whether a strict target has a live adapter.
3. On **Review**, choose a pipeline or wrapper from the collapsible tree. The
   compiled graph lays the entry and steps out top to bottom with type colors,
   icons, `provider/model` inheritance, and declared inputs; hovering an input
   highlights its source. Wrapper targets compile with a runtime slot for the
   routed pipeline. Select a node for the bottom Detail panel's Prompt, Inputs,
   Policy, Limits, Routes, Source, and Raw tabs. Diagnostics sit above the graph;
   **Compare run** diffs snapshots and routed wraps are marked.
4. Press **Run this pipeline** to open the Debug dock. Start a run there and step
   through one current-step card at a time, typing a result and choosing
   **Complete and continue**, or **Choose route** for a router.
5. Open **Runs** to observe owned runs, read events and the traffic log, and
   inspect prompts, results, inputs, and policy; start nothing there.
6. Open **Console** to call the engine's MCP tools through a schema-driven form,
   or run `clara-dev status lab --check` from a checkout in CI to compile a
   target and fail on errors.

## Desktop and remote

The lab has three parts, and only the first is a window:

1. **The desktop UI.** Clara Desktop compiles the lab UI into its own build and
   opens it at `/lab` in a flex slot under the app header. The deployed web/PWA
   build contains no lab code: the route is not registered, Vite replaces the lab
   modules with stubs, and the bundle check fails if a lab chunk reaches the web
   artifact.
2. **The lab service.** `@clara/lab-server` runs next to the engine, not on the
   desktop and not inside the hub. It owns the workspace files, preview and
   import graph, engine token, run and admin calls over MCP and SSE, and the
   engine asset cache. The packaged command supervises it as `lab` and serves the
   API only; the standalone workbench comes from `pnpm dev:lab`.
3. **The hub bridge.** The hub exposes `/v1/lab/*` and forwards it to the lab
   service's `/api/*`, with the shared `CLARA_LAB_TOKEN`. It holds no engine
   token. Point it with `CLARA_LAB_URL` (default `http://127.0.0.1:8791`), bind
   the service with `CLARA_LAB_HOST`, and set `CLARA_LAB_ALLOW_REMOTE=1` when the
   hub is remote. Keep the service on a private network or loopback.

The preview uses the engine's own standard packages: the lab caches the exact
std/default bundle by hash from `GET /v1/packages/assets` and resolves the same
config order (explicit, workspace `orchestration/index.yml`, bundled).

## Core business rules

1. **Preview is local, probe is remote.** Preview uses the same loader and
   compiler as the engine against the lab service's files; probe talks to the
   running engine over MCP and SSE.
2. **One host path, one reported workspace.** Settings keeps the host path
   editable and shows the service path from `GET /v1/config` read-only; the
   debug dock always uses the reported path. The Lab is the supported place to
   choose a target; model-facing `clara_start` uses the active config's entry.
3. **The lab impersonates the harness.** It uses the work-order surface with a
   work token and the operator REST endpoints. It never calls a model, creates an
   agent session, or enforces real policy, and a strict target self-registers the
   `clara-lab` adapter. Heartbeats renew automatically every ten seconds.
4. **The desktop holds no engine credentials, and the files belong to the lab
   host.** The lab service keeps the engine token and calls the engine directly;
   the desktop sees only `/v1/lab` responses. The lab is a viewer and probe: it
   never writes YAML, Markdown, or prompts, never publishes packages to the
   engine, and reloads when its files change.
5. **Runs is observation-only.** Starting, pausing, pulling, completing, routing,
   and spawning live in the Review Debug dock. Debug runs carry
   `origin_harness: "clara-lab"` and are hidden behind a persisted **Show debug
   runs** toggle; **Cancel run** and **Kill all runs** sit on the run header.

## Edge cases

- The engine is offline: preview still works, Settings shows "Waiting for the
  engine…", and run actions retry once it reports a workspace.
- The host path compiles but the engine reports a path it cannot read: Settings
  shows "Engine workspace: Needs attention"; set `CLARA_ENGINE_WORKSPACE` on the
  service to its mounted workspace.
- No token is present or the engine rejects it: Settings and the status bar show
  the problem and the token hint; restart the lab with the service's token.
- The std/default bundle cannot be fetched: the workspace's own packages still
  compile, but the run may use a different bundle until the token is fixed.
- A lab service restarts: in-memory work tokens are lost and the watchdog retries
  the step after the stall threshold.
- The hub cannot reach the lab service: the desktop reports it unavailable;
  check `CLARA_LAB_URL`, the shared token, and `CLARA_LAB_HOST`.
- A file changes during a run: the pinned snapshot stays authoritative and the
  comparison view shows the difference.

## Out of scope

- Calling a model, starting a harness session, or spawning processes.
- Real policy enforcement; the `clara-lab` adapter deliberately enforces nothing.
- Editing pipelines, prompts, or policies in the browser.
- Public exposure, package publishing, or a visual pipeline editor.
- Starting or stepping a run from **Runs**.

## Known gaps

- The lab trusts the workspace reported by the engine and does not verify that
  the host path and the service mount point at the same files.
- Only root-package imports are directly selectable; nested imports are reached
  through their parent.
- Source view is capped at 512 KB per file.
- The Console form handles strings, numbers, booleans, enums, arrays of strings,
  and nested objects; other schema shapes fall back to JSON.
- Runs created through the Console without an origin, or before origin tracking,
  are treated as external and never appear in the Debug dock.
- Scripted response playback and run rewinding are not implemented.

## Technical appendix

<details>
<summary>Commands, routes, and packages</summary>

- Start: `clara start` (stack) or `clara start lab`; desktop UI at `/lab`;
  validate with `clara-dev status lab --check`; dev with `pnpm dev:lab`
  (Vite `5175`, service `8791`).
- Service environment: `CLARA_LAB_PORT`, `CLARA_LAB_HOST`, `CLARA_LAB_TOKEN`,
  `CLARA_LAB_ALLOW_REMOTE`, `CLARA_ENGINE_URL`, `CLARA_ENGINE_TOKEN`,
  `CLARA_ENGINE_TOKEN_FILE`, `CLARA_ENGINE_WORKSPACE`, `CLARA_ENGINE_CONFIG`.
- Hub environment: `CLARA_LAB_URL` and `CLARA_LAB_TOKEN` (must match).
- Service routes: `GET /api/health`, `GET /api/state`, `GET /api/stream`,
  `POST /api/preview`, `POST /api/preflight`, `POST /api/diff`,
  `POST /api/tools/:name`, `GET /api/runs`, `POST /api/runs/cancel-all`,
  `GET /api/inbox`, `GET /api/source`, `POST /api/heartbeat`.
- Assets: `GET /v1/packages/assets` returns `{ hash, version, files }`; the lab
  caches it under `CLARA_CACHE_DIR/lab/assets/<hash>`.
- Packages: UI `@clara/lab`, service `@clara/lab-server`, preview SDK
  `@clara/pipeline-preview`, standalone entry `tools/lab`.
- See [packages.md](packages.md) for the DSL and [execution.md](execution.md)
  for runs and leases.

</details>
