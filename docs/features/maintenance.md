# Clara maintenance rebuild

## Summary

The maintenance package keeps three pipelines:

- `rebuild` snapshots the running Clara setup, including the web client
  container, rebuilds the checkout, reinstalls the configured harness adapters, restarts
  exactly the services that were running, and verifies their health. It retries
  restart and health once and has a bounded recovery branch that restarts only
  the unhealthy captured services.
- `recover` restores services from the **current** snapshot without rebuilding or
  capturing a new one. It is the right command after a failed restart, when
  re-capturing would record dead services as stopped.
- `diagnose` collects a failed run and the snapshot, classifies the failure with
  two read-only agents, and returns safe next actions. It never repairs.

All three use `observed` enforcement so they can run while the adapter or setup
is degraded. The deterministic mechanics still live in `pnpm clara rebuild …`
and `pnpm clara orchestrator inspect`.

## User flow

1. Ask Clara to “rebuild Clara”, “restart all Clara services”, “recover the
   Clara services”, or “diagnose why the rebuild failed”. Clara’s primary
   router selects `rebuild`, `recover`, or `diagnose`. In Clara Lab, choose
   `std:maintenance/rebuild`, `std:maintenance/recover`, or
   `std:maintenance/diagnose` directly.
2. `rebuild` captures the live setup: the primary checkout, git revision, Node
   and pnpm versions, the adapter and MCP entries, every running orchestrator,
   Lab, hub, and web container, and each service's deployment form
   (`local`, `container`, or `stopped`; an orchestrator also carries an
   `external` flag). It writes the snapshot used by the later steps.
3. The build step runs `pnpm install --frozen-lockfile` and `pnpm build` in the
   captured build checkout.
4. The adapter step links the OpenCode adapter, installs the Clara agent file,
   and refreshes the MCP entry when it was already configured.
5. The restart step brings back only the services captured as running, in the
   captured form. It restarts the web container, Lab, and hub first and
   the orchestrator last, waiting for each health endpoint before moving on. A
   containerized hub is stopped and recreated with compose instead of
   being signalled by PID; the web container is recreated with a fresh image
   build.
6. The verify step probes every captured service and adapter, compares the
   workspace and deployment mode with the snapshot, and reports warnings or
   failures.
7. If restart or health fails after its retry, the recovery branch runs
   `pnpm clara rebuild recover`. That restarts only the expected services whose
   health probe failed, waits for them, and then the failed step is retried once.
   A recovery never re-captures the snapshot.
8. `recover` runs the same inspection and targeted restart without a build. It
   refuses a stale snapshot, leaves external or stopped services alone, and ends
   with a hard health gate.
9. `diagnose` reads the failed run’s steps, attempts, exit codes, alerts, and the
   snapshot health/journal/log tail, then returns a classification and one safe
   next action. A build or test failure is routed to a software bug run, not to
   maintenance recovery.

## Core business rules

1. **The snapshot is the contract.** `status` writes it, `restart`, `recover`,
   and `health` read it. A service that was stopped when captured stays stopped.
2. **Deployment form is saved.** The snapshot records `local`, `container`, or
   `stopped` for the hub, orchestrator, Lab, and web client, plus an
   `external` flag for an orchestrator managed outside the checkout. A
   containerized hub or web client is recreated with compose, and a
   captured local hub is never restarted by signalling a container PID.
3. **Recovery uses the same snapshot.** Re-running `status` after a partial
   restart would mark dead services as stopped, so recovery never recaptures.
   A new `rebuild` is the only thing that takes a new snapshot.
4. **Every automatic step is a script.** Restart and health retry once and have
   a deterministic recovery branch. There is no model, prompt, turn budget, or
   token budget in `rebuild` or `recover`; the two agents live only in
   `diagnose`, read-only, after the run has already failed.
5. **The orchestrator restarts last.** The runner executes on the workspace
   host. The default OpenCode adapter embeds one, so restarting the orchestrator
   does not kill the run. The command waits for `/health` before the runner
   reports completion, and an interrupted restart resumes from its journal
   instead of restarting twice.
6. **External orchestrators are verified, not restarted.** An orchestrator
   reached through a non-loopback URL, such as a development container’s
   `http://orchestrator:8789`, is treated as managed outside the checkout. Pass
   `--manage-external` to opt in.
7. **Adapters are installed, not hot-reloaded.** The adapter link and agent file
   are updated during the rebuild. OpenCode is never restarted mid-run; it picks
   up the files on its next start.
8. **Health is endpoint-based.** The pipeline checks the orchestrator
   `/health` and `/v1/config`, the Lab `/api/health`, the hub panel and
   local `/health`, the web client `/healthz`, and the adapter files. A healthy
   endpoint with the wrong workspace or deployment mode is reported as a
   warning.
9. **Recovered failures do not page Clara.** A failed attempt is recorded, but
   the failure alert is deferred until recovery is exhausted. A successful
   recovery emits `step.recovered`; only a failed recovery creates an alert.

## Edge cases

- **No runner is live:** a script step stays ready and the watchdog opens a
  `no_runner` alert. Start the shared runner service or `clara-runner`.
- **A script times out:** the runner terminates the process group and fails the
  step with the exit code and output tail.
- **The orchestrator is stopped:** capture records it as stopped, the restart
  step leaves it stopped, and health does not expect it.
- **The orchestrator runs in a container:** a loopback container is restarted
  through compose with a rebuild; a non-loopback container is skipped as
  external unless `--manage-external` is passed.
- **The run was started from Clara Lab:** restarting the Lab kills the debug
  dispatcher. The normal Clara hub path is safe; the operator can pass
  `--skip lab` when driving the pipeline from the Lab.
- **The hub runs in a container:** restart stops and recreates it with
  `pnpm clara server stop --docker` and `pnpm clara server start --docker
--build`, then waits for the panel `/health` endpoint. The container is
  detected from its health `mode` or, if the panel is down, from the running
  compose service. No host PID is signalled.
- **The hub changed form:** if the snapshot captured a local hub but a
  container is now serving the same ports, restart refuses instead of signalling
  the container. Re-capture or pass `--force`. Health reports a captured-mode
  change as a warning, not a failure.
- **The hub container is stopped when captured:** capture records the hub
  as stopped and the restart leaves it stopped. It does not start a service
  that was down before the rebuild.
- **The web client runs in a container:** restart stops and recreates it with
  `pnpm clara web stop --docker` and `pnpm clara web start --docker --build`,
  then waits for `/healthz`. The fresh build reuses any `VITE_CLARA_WS_URL` in
  `infra/docker/.env`, so keep a retargeted relay endpoint there when the image uses
  one.
- **The web client is served outside compose:** a healthy `/healthz` without a
  running compose service is captured as `local` and skipped with a warning;
  the pipeline cannot rebuild a static server it does not manage.
- **The web container is stopped when captured:** capture records it as stopped
  and the restart leaves it stopped, like the other services.
- **The hub is systemd-managed:** restart uses `systemctl --user restart
clara`. A manually started hub is restarted from the captured root with its
  process environment when readable; otherwise the step warns instead of
  silently dropping relay or push credentials.
- **The Lab predates the health metadata:** the listener pid is found through
  `lsof`, `ss`, or `fuser`. If no pid is available, the step asks for one manual
  restart rather than guessing.
- **A build or install fails:** the step fails with the command, exit code, and
  output tail. No service is restarted. Recovery is diagnosis-only.
- **Restart or health fails once:** the step retries. The restart journal makes
  the retry a resume, not a second rebuild.
- **Restart or health still fails:** the recovery branch runs
  `pnpm clara rebuild recover`, which restarts only the expected services that
  are not answering. The failed step is retried once. If recovery or the retry
  fails, the run fails with the original and recovery errors and one alert.
- **The snapshot is stale:** `restart`, `recover`, and `health` refuse a
  snapshot older than two hours. Re-run `status` or pass `--force` to
  `restart`/`recover`.
- **The restart is interrupted:** the journal records completed services. A
  retry skips them and finishes the rest.
- **The orchestrator takes longer than the stall threshold:** the watchdog may
  requeue the step. The journal turns the retry into a health check instead of a
  second rebuild.
- **OpenCode runs in a container without host access:** the build or restart
  step fails with a preflight error. Run the pipeline from a host-side OpenCode
  with the checkout, pnpm, and the service manager available.
- **The Lab is healthy but disconnected:** health reports the lost orchestrator
  connection as a warning; it does not restart or reconfigure the Lab.
- **`diagnose` has no snapshot:** `rebuild inspect` accepts exit 1, so the run
  still reports the failed step and asks the agent to avoid snapshot-based
  recovery.

## Out of scope

- Deploying the relay Worker or the web client to Cloudflare Pages.
- Updating dependencies, changing the lockfile, or migrating the database.
- Restarting OpenCode or reloading its plugins mid-run.
- Starting services that were stopped when the pipeline started.
- Repairing a misconfigured Lab or hub instead of replicating it.
- Applying arbitrary repairs from a model. `diagnose` is read-only; `recover`
  only restarts captured, expected, unhealthy services.
- Remote orchestration or a non-Clara workspace.

## Known gaps

- A manually started hub can lose environment-only credentials when the
  process environment is not readable; systemd-managed hubs do not.
- A containerized hub is rebuilt from its Dockerfile, not from the host
  `apps/hub/server/dist`; the restart step stops it and runs `server start --docker
--build` from the captured build checkout.
- The hub container form is saved from the panel health `mode` or a
  running compose service. A stopped container is recorded as `stopped`, not as
  a container that should be restarted.
- The web container form is saved from its `/healthz` response and a running
  compose service. A web client served by another static server is captured as
  `local` and is not restarted by the pipeline.
- A rebuilt web image takes `VITE_CLARA_WS_URL` from `infra/docker/.env` (or the
  environment). If a previous image retargeted relay rooms and the value is
  missing, the new image falls back to the relay URL in each pairing code.
- A Lab started with `pnpm dev:lab` is restarted as the built Lab server, not
  with its Vite development process.
- A containerized OpenCode needs host access to `pnpm`, git, docker or systemd,
  and the loopback service ports.
- The adapter reload is deferred to the next OpenCode start because restarting
  OpenCode would kill the worker running the pipeline.
- The Lab-driven restart remains a developer caveat; the pipeline cannot tell
  whether the Lab is its own dispatcher.
- Automatic recovery is limited to restart and health. A build, install, or
  adapter failure stops the run and needs `diagnose` plus a human decision.
- `diagnose` selects the latest failed root run unless the request names a run
  id; it does not search across multiple failures.

## Technical appendix

<details>
<summary>Commands, state, endpoints, and references</summary>

- Pipeline: `std:maintenance/rebuild`, `std:maintenance/recover`, and
  `std:maintenance/diagnose`; package `packages/orchestration/engine/std/maintenance`.
- CLI: `pnpm clara rebuild status|build|adapters|restart|health|inspect|recover`
  with `--json`, `--root <path>`, `--state <path>`, `--dry-run`,
  `--manage-external`, `--force`, `--skip <service>`, `--lines <n>`, and
  `--mcp` / `--no-mcp`. Service restarts default to Docker; pass `--local` for
  local services or `--all` for a mixed setup.
- Run evidence: `pnpm clara orchestrator inspect [--run <id> | --request
<path> | --request-env] [--json]`. `--request-env` reads `CLARA_REQUEST` in a
  script step. Without a run id it selects the latest failed root run for the
  workspace.
- Snapshot: `${CLARA_DATA_DIR:-~/.local/share/clara}/rebuild/setup.json` (mode
  `0600`). Restart journal: `rebuild/restart.json`. Log: `rebuild/rebuild.log`.
  The snapshot is host control state for both local and Docker stacks; it is not
  part of the Docker volumes. Use `pnpm clara backup` for the volumes.
- Deployment state: the snapshot's `deployment` block records `server.mode`,
  `orchestrator.mode`, `lab.mode`, and `web.mode` as `local`, `container`, or
  `stopped`, plus `orchestrator.external`. `server.container` and
  `web.container` are the boolean forms. Older snapshots without the block fall
  back to `server.mode` or the running server compose service; snapshots that
  still use the old `control` key are migrated when read.
- Capture: `GET <orchestrator>/health`, `GET <orchestrator>/v1/config`, Lab
  `GET /api/health`, panel `GET /health`, local `GET /health`, and web
  `GET /healthz`. The detailed panel status API requires a session, so the
  rebuild uses the minimal health route. The panel health `mode` is the primary
  source for the hub deployment form; a running compose service is the
  fallback when the panel is down. The web form uses the running web compose
  service as its container signal.
- Restart order: web, Lab, hub, orchestrator. The orchestrator is last
  and the command waits for its health endpoint. A containerized hub is
  stopped and recreated with compose rather than signalled by PID; the web
  client is recreated with a fresh image build; local restarts use systemd when
  active, then the captured PID.
- Recovery: `recover` probes health, selects only `expected && !healthy`
  services, restarts them in the same order, and re-runs health. It never
  restarts a healthy service or starts one that was stopped at capture.
- Adapter install: `clara-adapter-opencode install` or `pnpm clara adapter install --opencode`; MCP refresh:
  `pnpm clara adapter install --opencode --mcp --no-service` or
  `pnpm clara mcp install --no-start`.
- Adapter release: run the `adapter-releases` workflow from
  **Actions → adapter-releases → Run workflow**. It builds each OS on its own
  runner, uploads kind-prefixed archives to the `adapters-v<version>` GitHub
  release, and exports `apps/web/public/adapters/<kind>/{manifest.json,v<version>-install.sh}`
  as the `adapter-registry` workflow artifact. The maintainer copies that
  artifact into `apps/web/public/adapters` and runs `pnpm deploy:web`. A local
  `pnpm adapters:build` builds only the host target under `dist/adapters` and is
  not the canonical registry. The hub reads `CLARA_ADAPTER_REGISTRY_URL` or the
  panel setting; it never embeds an adapter.
- Default ports: orchestrator `8789`, panel `8790`, local hub `8788`, Lab
  `8791`, web `8080`. `CLARA_LAB_PORT`, `CLARA_PANEL_PORT`,
  `CLARA_LOCAL_PORT`, `CLARA_WEB_PORT`, and `CLARA_ORCHESTRATION_URL` override
  discovery. The hub container uses
  `pnpm clara server status|start --docker`; the web container uses
  `pnpm clara web status|start --docker`.
- Tests: `tools/cli/test/rebuild.test.mjs`,
  `tools/cli/test/web-control.test.mjs`,
  `packages/orchestration/engine/test/loader.test.ts`,
  `packages/orchestration/engine/test/evidence.test.ts`, and
  `packages/preview/test/preview.test.ts`.
- See [orchestration.md](orchestration.md) for the engine and
  [capabilities.md](capabilities.md) for shipped scope.

</details>
