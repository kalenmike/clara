# Clara maintenance rebuild

## Summary

The maintenance package keeps three pipelines:

- `rebuild` snapshots the running Clara setup, including the web client,
  rebuilds the checkout, reinstalls the configured harness adapters, restarts
  exactly the services that were running, and verifies their health. It retries
  restart and health once and has a bounded recovery branch that restarts only
  the unhealthy captured services.
- `recover` restores services from the **current** snapshot without rebuilding or
  capturing a new one. It is the right command after a failed restart, when
  re-capturing would record dead services as stopped.
- `diagnose` collects a failed run and the snapshot, classifies the failure with
  two read-only agents, and returns safe next actions. It never repairs.

All three use `observed` enforcement so they can run while the adapter or setup
is degraded. The deterministic mechanics still live in `clara rebuild …`
and `clara-engine inspect`.

## User flow

1. Ask Clara to “rebuild Clara”, “restart all Clara services”, “recover the
   Clara services”, or “diagnose why the rebuild failed”. Clara’s primary
   router selects `rebuild`, `recover`, or `diagnose`. In Clara Lab, choose
   `std:maintenance/rebuild`, `std:maintenance/recover`, or
   `std:maintenance/diagnose` directly.
2. `rebuild` captures the live setup: the primary checkout, git revision, Node
   and pnpm versions, the adapter and MCP entries, every running engine,
   Lab, hub, and web client, and each service's deployment form
   (`local`, `host`, or `stopped`; an engine also carries an `external` flag).
   It writes the snapshot used by the later steps.
3. The build step runs `pnpm install --frozen-lockfile` and `pnpm build` in the
   captured build checkout.
4. The adapter step links the OpenCode adapter, installs the Clara agent file,
   and refreshes the MCP entry when it was already configured.
5. The restart step brings back only the services captured as running, in the
   captured form. It restarts the web client, Lab, and hub first and the engine
   last, waiting for each health endpoint before moving on. A service captured
   as a container is reported as managed outside the installation and skipped
   with a warning.
6. The verify step probes every captured service and adapter, compares the
   workspace and deployment mode with the snapshot, and reports warnings or
   failures.
7. If restart or health fails after its retry, the recovery branch runs
   `clara rebuild recover`. That restarts only the expected services whose
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
2. **Deployment form is saved.** The snapshot records `local`, `host`, or
   `stopped` for the hub, engine, Lab, and web client, plus an `external` flag
   for an engine managed outside the checkout. A service captured as a
   container is managed outside the installation and is skipped, never
   signalled by PID.
3. **Recovery uses the same snapshot.** Re-running `status` after a partial
   restart would mark dead services as stopped, so recovery never recaptures.
   A new `rebuild` is the only thing that takes a new snapshot.
4. **Every automatic step is a script.** Restart and health retry once and have
   a deterministic recovery branch. There is no model, prompt, turn budget, or
   token budget in `rebuild` or `recover`; the two agents live only in
   `diagnose`, read-only, after the run has already failed.
5. **The engine restarts last.** The runner executes on the workspace
   host. The default OpenCode adapter embeds one, so restarting the engine
   does not kill the run. The command waits for `/health` before the runner
   reports completion, and an interrupted restart resumes from its journal
   instead of restarting twice.
6. **External engines are verified, not restarted.** An engine
   reached through a non-loopback URL, such as a development container’s
   `http://engine:8789`, is treated as managed outside the checkout. Pass
   `--manage-external` to opt in.
7. **Adapters are installed, not hot-reloaded.** The adapter link and agent file
   are updated during the rebuild. OpenCode is never restarted mid-run; it picks
   up the files on its next start.
8. **Health is endpoint-based.** The pipeline checks the engine
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
- **The engine is stopped:** capture records it as stopped, the restart
  step leaves it stopped, and health does not expect it.
- **The engine runs outside this installation:** a non-loopback engine is
  skipped as external unless `--manage-external` is passed; a container-managed
  engine is skipped with a warning.
- **The run was started from Clara Lab:** restarting the Lab kills the debug
  dispatcher. The normal Clara hub path is safe; the operator can pass
  `--skip lab` when driving the pipeline from the Lab.
- **A service is managed outside the installation:** a container captured by
  an older snapshot or an engine behind a non-loopback URL is skipped with a
  warning. Restart it where it is managed and capture again.
- **The hub changed form:** if the snapshot captured a local hub but another
  process is now serving the same ports, restart refuses instead of signalling
  it. Re-capture or pass `--force`. Health reports the mode change as a warning,
  not a failure.
- **The web client was stopped when captured:** capture records it as stopped
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
  `clara rebuild recover`, which restarts only the expected services that
  are not answering. The failed step is retried once. If recovery or the retry
  fails, the run fails with the original and recovery errors and one alert.
- **The snapshot is stale:** `restart`, `recover`, and `health` refuse a
  snapshot older than two hours. Re-run `status` or pass `--force` to
  `restart`/`recover`.
- **The restart is interrupted:** the journal records completed services. A
  retry skips them and finishes the rest.
- **The engine takes longer than the stall threshold:** the watchdog may
  requeue the step. The journal turns the retry into a health check instead of a
  second rebuild.
- **OpenCode runs in a container without host access:** the build or restart
  step fails with a preflight error. Run the pipeline from a host-side OpenCode
  with the checkout, pnpm, and the service manager available.
- **The Lab is healthy but disconnected:** health reports the lost engine
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
- An old snapshot that captured a service as a container is reported as
  outside the installation and skipped. Re-run `clara rebuild status` after
  starting the service on the host.
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
- CLI: `clara rebuild status|build|adapters|restart|health|inspect|recover`
  with `--json`, `--root <path>`, `--state <path>`, `--dry-run`,
  `--manage-external`, `--force`, `--skip <service>`, `--lines <n>`, and
  `--mcp` / `--no-mcp`.
- Run evidence: `clara-engine inspect [--run <id> | --request
<path> | --request-env] [--json]`. `--request-env` reads `CLARA_REQUEST` in a
  script step. Without a run id it selects the latest failed root run for the
  workspace.
- Snapshot: `${CLARA_DATA_DIR:-~/.local/share/clara}/rebuild/setup.json` (mode
  `0600`). Restart journal: `rebuild/restart.json`. Log: `rebuild/rebuild.log`.
  The snapshot is host control state; back it up with the rest of the local
  data directories.
- Deployment state: the snapshot's `deployment` block records `server.mode`,
  `engine.mode`, `lab.mode`, and `web.mode` as `local`, `host`, or `stopped`,
  plus `engine.external`. Older snapshots that still use the old `control` key
  are migrated when read. A legacy `container` mode is reported as managed
  outside the installation.
- Capture: `GET <engine>/health`, `GET <engine>/v1/config`, Lab
  `GET /api/health`, panel `GET /health`, local `GET /health`, and web
  `GET /healthz`. The detailed panel status API requires a session, so the
  rebuild uses the minimal health route.
- Restart order: web, Lab, hub, engine. The engine is last and the command
  waits for its health endpoint. Local restarts use systemd when active, then
  the captured PID.
- Recovery: `recover` probes health, selects only `expected && !healthy`
  services, restarts them in the same order, and re-runs health. It never
  restarts a healthy service or starts one that was stopped at capture.
- Adapter install: `clara-adapter-opencode install` or
  `clara adapter install opencode`; MCP refresh: `clara adapter install opencode
--reuse-pairing --mcp`. `rebuild adapters` runs `clara adapter upgrade`, which
  reinstalls from the saved pairing.
- Adapter release: run the `adapter-releases` workflow from
  **Actions → adapter-releases → Run workflow**. It builds each OS on its own
  runner, uploads kind-prefixed archives to the `adapters-v<version>` GitHub
  release, and exports `apps/web/public/adapters/<kind>/{manifest.json,v<version>-install.sh}`
  as the `adapter-registry` workflow artifact. The maintainer copies that
  artifact into `apps/web/public/adapters` and runs `pnpm deploy:web`. When the
  archives already exist on a release,
  `pnpm adapters:build --from-release <tag|latest> --repo <owner/repo> --out apps/web/public/adapters`
  regenerates the manifest and install script from the release asset digests
  without downloading archives. `pnpm deploy:web:registry` does the whole
  publish step in one command: it pins the newest `adapters-v*` release,
  regenerates the registry, verifies every manifest, target, and artifact digest
  against that release, and then deploys the web app. `pnpm adapters:check` is
  the same verification without the deploy, and `pnpm deploy:web` runs that
  check before `wrangler` (against `CLARA_ADAPTER_RELEASE_TAG` when set) so an
  empty, partial, host-only, or stale registry cannot be published. A local `pnpm adapters:build` builds only the
  host target under `dist/adapters` and is not the canonical registry; pair it
  with `pnpm adapters:serve` and `CLARA_ADAPTER_REGISTRY_URL` to test a build.
  The hub reads `CLARA_ADAPTER_REGISTRY_URL` or the panel setting; it never
  embeds an adapter.
- Default ports: engine `8789`, panel `8790`, local hub `8788`, Lab
  `8791`, web `8080`. `CLARA_LAB_PORT`, `CLARA_PANEL_PORT`,
  `CLARA_LOCAL_PORT`, `CLARA_WEB_PORT`, and `CLARA_ENGINE_URL` override
  discovery.
- Tests: `tools/cli/test/rebuild.test.mjs`,
  `packages/orchestration/engine/test/loader.test.ts`,
  `packages/orchestration/engine/test/evidence.test.ts`, and
  `packages/preview/test/preview.test.ts`.
- See [orchestration.md](orchestration.md) for the engine and
  [capabilities.md](capabilities.md) for shipped scope.

</details>
