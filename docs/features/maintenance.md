# Clara maintenance rebuild

## Summary

The maintenance package keeps three pipelines:

- `rebuild` snapshots the running Clara setup, rebuilds the checkout, reinstalls
  the OpenCode adapters, restarts exactly the services that were running, and
  verifies their health. It retries restart and health once and has a bounded
  recovery branch that restarts only the unhealthy captured services.
- `recover` restores services from the **current** snapshot without rebuilding or
  capturing a new one. It is the right command after a failed restart, when
  re-capturing would record dead services as stopped.
- `diagnose` collects a failed run and the snapshot, classifies the failure with
  two read-only agents, and returns safe next actions. It never repairs.

All three use `observed` enforcement so they can run while the adapter or setup
is degraded. The deterministic mechanics still live in `pnpm clara rebuild …`
and `pnpm clara orchestration inspect`.

## User flow

1. Ask Clara to “rebuild Clara”, “restart all Clara services”, “recover the
   Clara services”, or “diagnose why the rebuild failed”. Clara’s primary
   router selects `rebuild`, `recover`, or `diagnose`. In Clara Lab, choose
   `std:maintenance/rebuild`, `std:maintenance/recover`, or
   `std:maintenance/diagnose` directly.
2. `rebuild` captures the live setup: the primary checkout, git revision, Node
   and pnpm versions, the adapter and MCP entries, and every running
   orchestrator, Lab, and home agent. It writes the snapshot used by the later
   steps.
3. The build step runs `pnpm install --frozen-lockfile` and `pnpm build` in the
   captured build checkout.
4. The adapter step links the OpenCode adapter, installs the Clara agent file,
   and refreshes the MCP entry when it was already configured.
5. The restart step brings back only the services captured as running. It
   restarts the Lab and the home agent first and the orchestrator last, waiting
   for each health endpoint before moving on.
6. The verify step probes every captured service and adapter, compares the
   workspace and mode with the snapshot, and reports warnings or failures.
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
2. **Recovery uses the same snapshot.** Re-running `status` after a partial
   restart would mark dead services as stopped, so recovery never recaptures.
   A new `rebuild` is the only thing that takes a new snapshot.
3. **Every automatic step is a script.** Restart and health retry once and have
   a deterministic recovery branch. There is no model, prompt, turn budget, or
   token budget in `rebuild` or `recover`; the two agents live only in
   `diagnose`, read-only, after the run has already failed.
4. **The orchestrator restarts last.** The runner executes on the workspace
   host. The default OpenCode adapter embeds one, so restarting the orchestrator
   does not kill the run. The command waits for `/health` before the runner
   reports completion, and an interrupted restart resumes from its journal
   instead of restarting twice.
5. **External orchestrators are verified, not restarted.** An orchestrator
   reached through a non-loopback URL, such as a development container’s
   `http://orchestrator:8789`, is treated as managed outside the checkout. Pass
   `--manage-external` to opt in.
6. **Adapters are installed, not hot-reloaded.** The adapter link and agent file
   are updated during the rebuild. OpenCode is never restarted mid-run; it picks
   up the files on its next start.
7. **Health is endpoint-based.** The pipeline checks the orchestrator
   `/health` and `/v1/config`, the Lab `/api/health`, the home-agent panel and
   local `/health`, and the adapter files. A healthy endpoint with the wrong
   workspace or mode is reported.
8. **Recovered failures do not page Clara.** A failed attempt is recorded, but
   the failure alert is deferred until recovery is exhausted. A successful
   recovery emits `step.recovered`; only a failed recovery creates an alert.

## Edge cases

- **No runner is live:** a script step stays ready and the watchdog opens a
  `no_runner` alert. Start the embedded adapter runner or `pnpm clara runner`.
- **A script times out:** the runner terminates the process group and fails the
  step with the exit code and output tail.
- **The orchestrator is stopped:** capture records it as stopped, the restart
  step leaves it stopped, and health does not expect it.
- **The orchestrator runs in a container:** a loopback container is restarted
  through compose with a rebuild; a non-loopback container is skipped as
  external unless `--manage-external` is passed.
- **The run was started from Clara Lab:** restarting the Lab kills the debug
  dispatcher. The normal Clara agent path is safe; the operator can pass
  `--skip lab` when driving the pipeline from the Lab.
- **The home agent is systemd-managed:** restart uses `systemctl --user restart
clara`. A manually started agent is restarted from the captured root with its
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

- Deploying the web app or relay Worker.
- Updating dependencies, changing the lockfile, or migrating the database.
- Restarting OpenCode or reloading its plugins mid-run.
- Starting services that were stopped when the pipeline started.
- Repairing a misconfigured Lab or home agent instead of replicating it.
- Applying arbitrary repairs from a model. `diagnose` is read-only; `recover`
  only restarts captured, expected, unhealthy services.
- Remote orchestration or a non-Clara workspace.

## Known gaps

- A manually started home agent can lose environment-only credentials when the
  process environment is not readable; systemd-managed agents do not.
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
  `std:maintenance/diagnose`; package `lib/std/maintenance`.
- CLI: `pnpm clara rebuild status|build|adapters|restart|health|inspect|recover`
  with `--json`, `--root <path>`, `--state <path>`, `--dry-run`,
  `--manage-external`, `--force`, `--skip <service>`, `--lines <n>`, and
  `--mcp` / `--no-mcp`.
- Run evidence: `pnpm clara orchestration inspect [--run <id> | --request
<path> | --request-env] [--json]`. `--request-env` reads `CLARA_REQUEST` in a
  script step. Without a run id it selects the latest failed root run for the
  workspace.
- Snapshot: `${CLARA_DATA_DIR:-~/.local/share/clara}/rebuild/setup.json` (mode
  `0600`). Restart journal: `rebuild/restart.json`. Log: `rebuild/rebuild.log`.
- Capture: `GET <orchestrator>/health`, `GET <orchestrator>/v1/config`, Lab
  `GET /api/health`, panel `GET /panel/api/v1/status`, local `GET /health`.
- Restart order: Lab, home agent, orchestrator. The orchestrator is last and
  the command waits for its health endpoint.
- Recovery: `recover` probes health, selects only `expected && !healthy`
  services, restarts them in the same order, and re-runs health. It never
  restarts a healthy service or starts one that was stopped at capture.
- Adapter install: `pnpm clara adapter install opencode`; MCP refresh:
  `pnpm clara mcp install --no-start`.
- Default ports: orchestrator `8789`, panel `8790`, local agent `8788`, Lab
  `8791`. `CLARA_LAB_PORT`, `CLARA_PANEL_PORT`, `CLARA_LOCAL_PORT`, and
  `CLARA_ORCHESTRATION_URL` override discovery.
- Tests: `scripts/test/rebuild.test.mjs`,
  `packages/orchestration/test/loader.test.ts`,
  `packages/orchestration/test/evidence.test.ts`, and
  `packages/devtools/test/preview.test.ts`.
- See [orchestration.md](orchestration.md) for the engine and
  [capabilities.md](capabilities.md) for shipped scope.

</details>
