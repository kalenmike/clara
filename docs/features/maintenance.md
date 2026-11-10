# Clara maintenance rebuild

## Summary

The rebuild pipeline snapshots the running Clara setup, rebuilds the checkout,
reinstalls the OpenCode adapters, restarts exactly the services that were
running, and verifies their health. It is the standard way to bring a rebuilt
Clara back to the setup it had before the rebuild.

## User flow

1. Ask Clara to “rebuild Clara”, “restart all Clara services”, or “verify the
   Clara services after a rebuild”. Clara’s primary router selects `rebuild`.
   In Clara Lab, choose `std:maintenance/rebuild` and start it directly.
2. The run captures the live setup: the primary checkout, git revision, Node and
   pnpm versions, the adapter and MCP entries, and every running orchestrator,
   Lab, and home agent. It writes the snapshot used by the later steps.
3. The build step runs `pnpm install --frozen-lockfile` and `pnpm build` in the
   captured build checkout.
4. The adapter step links the OpenCode adapter, installs the Clara agent file,
   and refreshes the MCP entry when it was already configured.
5. The restart step brings back only the services captured as running. It
   restarts the Lab and the home agent first and the orchestrator last, waiting
   for each health endpoint before moving on.
6. The verify step probes every captured service and adapter, compares the
   workspace and mode with the snapshot, and reports warnings or failures.
7. Clara reports the health JSON. A failure stops the run with the failing
   service, endpoint, and log path.

## Core business rules

1. **The snapshot is the contract.** `status` writes it, `restart` and `health`
   read it. A service that was stopped when captured stays stopped.
2. **Every step is a script.** Each step runs exactly one
   `pnpm clara rebuild …` command. There is no model, prompt, turn budget, or
   token budget, so the rebuild mechanics stay in the deterministic CLI.
3. **The orchestrator restarts last.** The runner executes on the workspace
   host. The default OpenCode adapter embeds one, so restarting the orchestrator
   does not kill the run. The command waits for `/health` before the runner
   reports completion, and an interrupted restart resumes from its journal
   instead of restarting twice.
4. **External orchestrators are verified, not restarted.** An orchestrator
   reached through a non-loopback URL, such as a development container’s
   `http://orchestrator:8789`, is treated as managed outside the checkout. Pass
   `--manage-external` to opt in.
5. **Adapters are installed, not hot-reloaded.** The adapter link and agent file
   are updated during the rebuild. OpenCode is never restarted mid-run; it picks
   up the files on its next start.
6. **Health is endpoint-based.** The pipeline checks the orchestrator
   `/health` and `/v1/config`, the Lab `/api/health`, the home-agent panel and
   local `/health`, and the adapter files. A healthy endpoint with the wrong
   workspace or mode is reported.

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
  output tail. No service is restarted.
- **The snapshot is stale:** `restart` refuses a snapshot older than two hours.
  Re-run `status` or pass `--force`.
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

## Out of scope

- Deploying the web app or relay Worker.
- Updating dependencies, changing the lockfile, or migrating the database.
- Restarting OpenCode or reloading its plugins mid-run.
- Starting services that were stopped when the pipeline started.
- Repairing a misconfigured Lab or home agent instead of replicating it.
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

## Technical appendix

<details>
<summary>Commands, state, endpoints, and references</summary>

- Pipeline: `std:maintenance/rebuild`, package `lib/std/maintenance`.
- CLI: `pnpm clara rebuild status|build|adapters|restart|health` with `--json`,
  `--root <path>`, `--state <path>`, `--dry-run`, `--manage-external`, `--force`,
  `--skip <service>`, and `--mcp` / `--no-mcp`.
- Snapshot: `${CLARA_DATA_DIR:-~/.local/share/clara}/rebuild/setup.json` (mode
  `0600`). Restart journal: `rebuild/restart.json`. Log: `rebuild/rebuild.log`.
- Capture: `GET <orchestrator>/health`, `GET <orchestrator>/v1/config`, Lab
  `GET /api/health`, panel `GET /panel/api/v1/status`, local `GET /health`.
- Restart order: Lab, home agent, orchestrator. The orchestrator is last and
  the command waits for its health endpoint.
- Adapter install: `pnpm clara adapter install opencode`; MCP refresh:
  `pnpm clara mcp install --no-start`.
- Default ports: orchestrator `8789`, panel `8790`, local agent `8788`, Lab
  `8791`. `CLARA_LAB_PORT`, `CLARA_PANEL_PORT`, `CLARA_LOCAL_PORT`, and
  `CLARA_ORCHESTRATION_URL` override discovery.
- Tests: `scripts/test/rebuild.test.mjs`,
  `packages/orchestration/test/loader.test.ts`, and
  `packages/devtools/test/preview.test.ts`.
- See [orchestration.md](orchestration.md) for the engine and
  [capabilities.md](capabilities.md) for shipped scope.

</details>
