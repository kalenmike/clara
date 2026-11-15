# AGENTS.md — Clara

Clara is a browser/PWA client for agent harnesses, plus a hub: a small service on
your machine that carries harness traffic over an end-to-end encrypted WebSocket.
The hub and web client are harness-neutral; they reach a harness through a paired
adapter. The repository includes the OpenCode adapter. This file is the contract
for every AI agent working in this repo.

## Workspace

```text
apps/cli                             Packaged `clara` command, supervisor, releases, and adapters
apps/web                             React/Vite SPA (Cloudflare Pages or the web container)
apps/desktop                         Tauri shell that packages the web client for desktop
apps/desktop/host                    Loopback adapter-host sidecar for local, SSH, and Docker installs
apps/hub/panel                       Hub panel entry that serves the shared panel package
apps/hub/server                      Hub service, CLI, Bun executable, local WS + outbound Cloudflare relay
apps/engine                          Loopback engine service, REST/SSE/MCP
apps/adapters/opencode               OpenCode harness adapter, binding, and standalone bin
apps/adapters/claude                 Claude Code harness adapter and standalone bin
apps/adapters/pi                     Pi harness adapter and standalone bin (RPC mode)
tools/lab                            Standalone lab CLI and UI entry (clara-lab bin)
tools/docs                           User guide and internal documentation site
tools/cli                            Developer CLI for the stack, worktrees, and docs
packages/contracts/shared-types      Wire frames, actions, states, pairing payloads
packages/contracts/api-contract      Hub API DTOs, zod schemas, and OpenAPI components
packages/contracts/harness-protocol  Clara Harness Protocol frames and client
packages/api/api-client              Fetch-based hub API SDK
packages/api/mcp                     Read-only hub API MCP tools and stdio bridge
packages/orchestration/engine        Package loader, runtime, leases, and watchdog
packages/orchestration/engine/default Default routing config and classifier router
packages/orchestration/engine/std    Standard orchestration packages
packages/orchestration/policy        Step policy, budgets, and violation rules
packages/orchestration/control       Shared service paths, health, start, and stop helpers
packages/orchestration/mcp           Orchestration MCP tools and stdio bridge
packages/adapters/runtime            Harness-neutral adapter runtime and supervision
packages/adapters/binding            Orchestration binding client, delivery, and usage
packages/adapters/runner             Shared script runner for harness adapters
packages/adapters/install            Adapter install planning, target discovery, and jobs
packages/panel                       Shared hub panel UI for the served and bundled routes
packages/theme                       Shared palette and theme tokens for the web, panel, and lab
packages/lab                         Shared Clara Lab UI mounted by the desktop and the standalone entry
packages/lab-server                  Lab service: workspace preview, engine token, MCP/SSE, asset cache
packages/preview                     Pipeline preview, diagnostics, and snapshot diff SDK
packages/crypto                      Device-key derivation, AES-GCM envelopes, replay guard
infra/relay                          Cloudflare Worker + RelayRoom Durable Object
infra/docker                         Compose files, Dockerfiles, and the stack .env example
```

## Tech stack

- Node 22 (`.nvmrc`), pnpm 11 workspaces
- Vite 8, TypeScript 6, React 19, React Router 8
- Tailwind CSS 4 + shadcn/ui (`radix-nova` preset)
- TanStack Query 5 + a small external chat store
- `@opencode/client@2.1.1` — pinned to the targeted OpenCode server version; used only by the OpenCode adapter
- `@anthropic-ai/claude-agent-sdk@0.3.325` — pinned to Claude Code 2.1.325; used only by the Claude Code adapter
- Pi 1.5.x — driven as the user's installed `pi` binary over `--mode rpc`; the Pi SDK is not a dependency
- Tauri 2 and Rust for the web desktop app; `@tauri-apps/cli` and the `tauri` crates live only in `apps/desktop`
- Bun 1.4+ for the hub executable; `@clara/sqlite` selects `better-sqlite3` on Node and `bun:sqlite` under Bun
- `ws`, WebCrypto, Cloudflare Workers/Durable Objects, Wrangler

## Commands

```bash
pnpm task session start <name> # Create a worktree under ../clara-worktrees
pnpm task session list         # List task worktrees
pnpm task session close <name> # Check, merge, and remove a task worktree
pnpm dev            # Web on :5173 and the hub service on :8788
pnpm dev:web        # Web only
pnpm dev:panel      # Hub panel only
pnpm dev:lab        # Clara Lab (Vite :5175, lab server :8791)
pnpm dev:server     # Hub service only
pnpm dev:relay      # Local wrangler dev for the Worker/DO
pnpm build          # Build every workspace package
ENABLE_CLOUDFLARE_DEPLOYMENT=true pnpm build # Include the optional Cloudflare relay deployment
pnpm clara:link     # Install a thin `clara-dev` shim on ~/.local/bin
pnpm cli            # Run the packaged command from source
pnpm cli:build      # Build the Bun `clara` binary for the host
pnpm cli:install    # Install that build for the current user
pnpm cli:smoke      # Build and smoke the packaged binary
pnpm cli:uninstall  # Remove the installed command
clara start|stop|restart|status|ps|logs [hub|engine|web|lab] # Packaged stack lifecycle
clara setup         # Create the owner account, start, and optionally add a login service
clara update        # Verify and install a signed release (--check, --rollback)
clara adapter search|install|list|upgrade|verify|remove # Pull and manage harness adapters
clara adapter install <kind> --from <path> # Install a checkout adapter build
clara pair hub      # Print a browser pairing code
clara service       # install|uninstall|status|print the per-user login service
clara doctor|uninstall|version
clara start [default|hub|web|engine] [--docker|--local] [--build] # Start the core stack or one service
clara stop [default|hub|web|engine] [--docker|--local] # Stop the core stack or one service
clara restart [default|hub|web|engine] [--docker|--local] [--build] # Restart
clara status [default|hub|web|engine] [--json] # Probe the core services
clara logs [default|hub|web|engine] [--local|--docker] # Follow service logs
clara start hub --open # Start the hub and open the panel
clara status hub --open # Open the running panel
clara-dev mcp install [--api] # Checkout-only MCP bridge
clara start runner [--workspace <path>] # Start the shared runner service
clara stop runner [--purge] # Stop the runner service
clara status runner [--json] # Inspect the runner
clara-dev start lab [--workspace <path>] # Start only Clara Lab from a checkout
clara-dev status lab --check # Validate a package target for CI
clara start docs [--build] # Start the documentation site on :5176
clara status docs --check # Check guide and internal doc indexes and links
clara status docs --typecheck # Typecheck the documentation site
clara backup [default|hub|engine] [--output <path>] # Archive Docker state
clara restore [default|hub|engine] <archive> [--force] # Replace Docker state
clara pair [hub] # Print a browser pairing code
clara pair adapter --harness <name> # Print an adapter pairing code
clara rebuild       # Snapshot, rebuild, recover services, inspect, and verify health
pnpm check:boundaries # Fail if a harness SDK escapes its adapter package
pnpm adapters:build # Build host adapter artifacts and a local registry under dist/adapters
pnpm adapters:serve # Serve that registry on 127.0.0.1:8799 for the packaged command
clara-adapter-claude install --pair <code> # Standalone Claude Code adapter install
clara-adapter-pi install --pair <code> # Standalone Pi adapter install
clara-adapter-opencode install --pair <code> [--mcp] # Standalone OpenCode adapter install
pnpm typecheck      # tsc -b
pnpm lint           # ESLint
pnpm format         # Prettier write
pnpm format:check   # Prettier check
pnpm test           # All package tests
pnpm knip           # Unused files, exports, and dependencies
pnpm check          # typecheck + lint + format:check + knip + test
pnpm commitlint     # Lint the last commit message (also enforced on commit)
pnpm deploy:web     # Pages deploy
pnpm deploy:relay   # Worker deploy
pnpm desktop:dev    # Desktop window with the Vite desktop mode
pnpm desktop:build  # Native installer for the host OS (needs Rust + WebView dev packages)
pnpm desktop:build:app # App bundle without installers
pnpm desktop:build:docker # Linux bundles in Docker, extracted to dist/desktop
pnpm desktop:icons  # Regenerate the desktop icons from the web mark
pnpm hub:binary     # Build the embedded-panel Bun hub executable
pnpm hub:headless   # Headless hub archive with install helpers, under dist/headless
```

## Worktrees

Every new unit of work starts in a task worktree. Do not edit the primary
checkout or commit on `main`.

1. From the primary checkout, run `pnpm task session start <name>`. This creates
   `../clara-worktrees/<name>` on branch `task/<name>` and installs
   dependencies. A name is optional, but name parallel work explicitly.
2. Move the OpenCode session into the printed directory (or `cd` there) and do
   all edits, tests, and commits there.
3. Run `pnpm check` and `pnpm build` before finishing.
4. From the primary checkout, run `pnpm task session close <name>`. It refuses
   dirty trees, re-runs both gates, merges into the primary `HEAD`, removes the
   worktree, and deletes the branch.

Never merge by hand, never reuse a task worktree for unrelated work, and never
create a task worktree outside `../clara-worktrees` (override with
`CLARA_WORKTREES_DIR`). See [docs/development.md](docs/development.md).

## Harness contract

- Clara targets OpenCode 2.1.x through the included adapter and the v2 HTTP API
  under `/api`, Claude Code 2.1.325 through the Agent SDK in the Claude Code
  adapter, and Pi 1.5.x by driving the installed `pi` binary in RPC mode.
- The OpenCode harness SDK is `@opencode/client`, version-matched to the server
  and used only inside `apps/adapters/opencode`. Do not swap it
  for `@opencode-ai/sdk` (v1 API) or import `@opencode/sdk` into the browser
  (embedded Node server). The Claude Code harness SDK is
  `@anthropic-ai/claude-agent-sdk`, pinned inside `apps/adapters/claude`. Neither
  SDK may appear in the hub, web, shared packages, or the other adapter. The Pi
  adapter has no Pi SDK dependency: it runs the user's binary over JSONL RPC.
- The hub API contract in `packages/contracts/api-contract` owns the Clara DTOs and
  OpenAPI components. The web, `@clara/api-client`, and `@clara/api-contract`
  must not import or depend on a harness SDK. The hub itself has no harness
  SDK; adapters connect out over the Clara Harness Protocol.
- The browser connects only through the hub over the local or relay
  WebSocket, and only to the hub API under `/v1` through `@clara/api-client`.
  The adapter adds harness authentication; the browser never receives the
  harness password and has no generic harness proxy.
- Harness adapters are paired from the authenticated hub panel and stored in
  the hub's SQLite database. Each adapter discovers its harness on its own
  machine; the hub never reads OpenCode's `service.json`, contacts the harness,
  or stores the harness password. It stores only the adapter identity,
  capability set, versions, and encrypted adapter credential.
- Session lists are scoped by `directory`, not `project`. Sessions can report
  `projectID: "global"`; always build links from the selected project ID.

Read [docs/architecture/overview.md](docs/architecture/overview.md) before
changing connection, auth, streaming, or version pins. Read
[docs/architecture/api.md](docs/architecture/api.md) before changing the hub
API, OpenAPI document, or read-only MCP. Read
[docs/architecture/relay.md](docs/architecture/relay.md) and
[docs/architecture/e2ee.md](docs/architecture/e2ee.md) before changing the
transport, Worker, Durable Object, or crypto.

## Conventions

- Use **hub** for the home-side installation, **hub service** for its process,
  and **hub panel** for its dashboard. Reserve **agent** for LLM agents. See the
  [vocabulary](docs/architecture/overview.md#vocabulary).
- Use **engine** for the deterministic pipeline service (`@clara/engine`,
  `clara-engine`, the `clara-engine` container) and **orchestration** for the
  feature, packages, and pipelines. The engine is never an LLM or an agent.
- Write platform behavior as **harness** and **adapter**. Name OpenCode only for
  the included adapter, its install commands, or a fact specific to OpenCode.
- Web components live under `apps/web/src/components`; web hooks under
  `apps/web/src/features`. Server code lives under `apps/hub/server/src`.
- Use the shadcn components in `apps/web/src/components/ui`; add new ones with
  `pnpm dlx shadcn@latest add <name>` and keep the generated aliases.
- Path alias: `@/` maps to `apps/web/src/`.
- Prefer `type` imports. No `any`; use the SDK's exported types.
- Keep server state in TanStack Query and live stream state in `chatStore`.
  Invalidate queries from `EventProvider` instead of polling.
- Use `packages/contracts/shared-types` for wire types and `packages/crypto` for E2EE.
  Use Clara DTOs from `packages/contracts/api-contract` outside the hub service and lab;
  keep OpenCode domain types inside `apps/hub/server`.
- The Worker/DO must not parse or persist encrypted payloads.
- Never store credentials outside `sessionStorage`/`localStorage` (the latter
  only when the user opts in). Never commit pairing codes, device keys, tokens, or
  `.env`/`.dev.vars`.
- Keep files focused; split a component once it carries more than one concern.
- The desktop shell lives in `apps/desktop` and consumes the web client built in
  desktop mode. The hub is a CLI service built in `apps/hub/server`, including
  its Bun executable. Keep Tauri dependencies out of the web, hub server, and
  shared packages; desktop-only web behavior sits behind the build-time surface
  flag.
- Commit incrementally with Conventional Commits; see [Commits](#commits).

## Planning

- Do not turn a plan into tasks until the user confirms it. While planning,
  keep the plan in the conversation.
- Once the user confirms the plan, record it in the session todo list and keep
  that list current: mark the active task `in_progress` when work starts and
  `completed` as soon as it is finished. Create the task worktree before making
  changes (see [Worktrees](#worktrees)).
- Update the todo list after every commit so it always shows what is done and
  what is next. Add follow-ups the user accepts and drop work they cut.
- Keep the list to deliverables from the confirmed plan, not a scratch pad for
  unrelated ideas.

## Commits

Commit as you work. Do not leave a whole feature request as one uncommitted
change, and do not commit every file edit. A feature request should normally
land as a handful of coherent commits (typically 2–6), each one a reviewable
step.

- Commit when a coherent unit is complete and the tree is runnable: a vertical
  slice, a refactor, a test batch, a docs update, or a tooling change.
- Split by concern, not by file. If the subject needs "and" to join unrelated
  work, split the commit.
- Keep every commit buildable. Run `pnpm typecheck` (or the affected package
  test) before intermediate commits and `pnpm check` before the final commit of
  a feature request.
- Use Conventional Commits: `<type>(<scope>): <subject>`. A `commit-msg` hook
  runs commitlint on every commit and rejects a non-conforming header.
  - Types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `perf`, `build`,
    `ci`.
  - Scopes are optional: `web`, `server`, `relay`, `crypto`, `types`, `docs`.
  - Subject: imperative, lowercase, no trailing period, 72 characters or less.
  - Body: explain why and any user-visible behavior change; wrap at 72.
- Add the harness and yourself as co-authors on every commit you create, in a
  trailer block after a blank line below the body:
  - `Co-authored-by: OpenCode <noreply@opencode.ai>` comes first, then
  - `Co-authored-by: <model name> <model address>` using the name the harness
    reports in its model section, not the provider or model ID. Derive the
    address from the vendor's convention; for example
    `DeepSeek V4.1 Flash <flash-v41@deepseek.ai>`.
  - Never add a co-author for a human who did not work on the change.
- Commit separable docs and capability updates on their own, e.g.
  `docs(chat): describe the plan-ready panel`. Fold docs into the feature commit
  only when they are not separable.
- Stage explicit paths. Do not use `git add -A`; never commit secrets, generated
  output, or unrelated work.
- Update the session todo list after each commit (see [Planning](#planning)).
- Do not force-push, rewrite published history, or amend commits unless the user
  asks.

Examples:

```text
feat(web): show plan-ready panel in the session side panel

Keep the plan summary visible while the user reviews the task list.

Co-authored-by: OpenCode <noreply@opencode.ai>
Co-authored-by: DeepSeek V4.1 Flash <flash-v41@deepseek.ai>
```

Subject-only examples:

```text
fix(server): keep push subscriptions across reconnects
test(web): cover timeline gap detection
docs(sessions): document archived session filters
```

## Documentation map

Clara has two documentation sets. Keep them separate:

- **User guide** — `tools/docs/guide/`, indexed by
  [tools/docs/guide/index.md](tools/docs/guide/index.md). Written for people using
  or hosting Clara. No source paths, database columns, or internal routes.
- **Internal documentation** — `docs/`, indexed by
  [docs/README.md](docs/README.md). Written for contributors and agents. This is
  the authoritative behavior reference.

The Docusaurus site renders both together: the guide at `/guide/` and the
internal set at `/internals/` behind a visible "Internal" banner. `docs/records/`
is never published.

### User guide

| Before you touch…                    | Read                                                                             |
| ------------------------------------ | -------------------------------------------------------------------------------- |
| Using Clara, pairing, sessions, chat | [tools/docs/guide/index.md](tools/docs/guide/index.md)                           |
| Hosting the hub, Docker, relay       | [tools/docs/guide/self-hosting/index.md](tools/docs/guide/self-hosting/index.md) |

### Internal documentation

| Before you touch…                  | Read                                                                     |
| ---------------------------------- | ------------------------------------------------------------------------ |
| Writing or updating a feature spec | [docs/features/GUIDE.md](docs/features/GUIDE.md)                         |
| Developer commands and worktrees   | [docs/development.md](docs/development.md)                               |
| Workspace, modes, auth, streaming  | [docs/architecture/overview.md](docs/architecture/overview.md)           |
| Relay Worker, DO, remote access    | [docs/architecture/relay.md](docs/architecture/relay.md)                 |
| E2EE, device keys, envelopes       | [docs/architecture/e2ee.md](docs/architecture/e2ee.md)                   |
| What ships and what does not       | [docs/features/capabilities.md](docs/features/capabilities.md)           |
| Engine service and control         | [docs/features/orchestration.md](docs/features/orchestration.md)         |
| Pipeline DSL and package fields    | [docs/features/orchestration-dsl.md](docs/features/orchestration-dsl.md) |
| Engine diagnosis and fixes         | [docs/features/diagnostics.md](docs/features/diagnostics.md)             |
| Rebuilding and restarting Clara    | [docs/features/maintenance.md](docs/features/maintenance.md)             |
| Pipeline preview and agent probe   | [docs/features/lab.md](docs/features/lab.md)                             |
| Pairing, QR codes, device storage  | [docs/features/pairing.md](docs/features/pairing.md)                     |
| Install, updates, offline caching  | [docs/features/install.md](docs/features/install.md)                     |
| Desktop shell and native build     | [docs/features/desktop.md](docs/features/desktop.md)                     |
| Hub CLI, Bun executable, ports     | [docs/features/hub-cli.md](docs/features/hub-cli.md)                     |
| Connection and credentials         | [docs/features/connection.md](docs/features/connection.md)               |
| Hub panel and local hub state      | [docs/features/panel.md](docs/features/panel.md)                         |
| Project/session browser            | [docs/features/sessions.md](docs/features/sessions.md)                   |
| Messages, tools, approvals         | [docs/features/chat.md](docs/features/chat.md)                           |
| Forking, forwarding                | [docs/features/fork.md](docs/features/fork.md)                           |
| Prompt box, commands, mentions     | [docs/features/composer.md](docs/features/composer.md)                   |
| Cost, tokens, context              | [docs/features/session-info.md](docs/features/session-info.md)           |
| Inbox notifications and sounds     | [docs/features/notifications.md](docs/features/notifications.md)         |
| Keyboard behavior                  | [docs/features/shortcuts.md](docs/features/shortcuts.md)                 |
| Everything else                    | [docs/README.md](docs/README.md)                                         |

## Definition of done

1. `pnpm check` passes.
2. `pnpm build` succeeds. The desktop shell is outside that build; run
   `pnpm desktop:build` when your change touches the client shell and
   `pnpm hub:binary` when it touches the hub executable.
3. The touched screen works against a live target harness, through the
   affected transport. For the included adapters, that means OpenCode 2.1.x,
   Claude Code 2.1.325, or Pi 1.5.x.
   A desktop shell change is verified by building the app on the affected
   platform and pairing it once.
4. Shipped-scope changes update
   [docs/features/capabilities.md](docs/features/capabilities.md) in the same
   change. User-visible changes also update the matching page under
   `tools/docs/guide/`.
5. No secrets, generated output, or unrelated files are staged.
6. Work is committed as coherent Conventional Commits, each carrying the
   OpenCode and model co-author trailers; `git status` shows only intentionally
   uncommitted follow-up work.
7. The work was done in a task worktree and landed with
   `pnpm task session close`; no task worktree or `task/*` branch remains.
