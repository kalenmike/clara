# AGENTS.md — Clara

Clara is a browser/PWA client for one running OpenCode server, plus a hub: a
small service on your machine that carries the OpenCode HTTP/SSE API over an
end-to-end encrypted WebSocket. This file is the contract for every AI agent
working in this repo.

## Workspace

```text
apps/web              React/Vite SPA (Cloudflare Pages or the web container)
apps/panel            Authenticated hub panel and setup surface
apps/lab              Loopback pipeline preview and agent probe
apps/server           Node hub service, local WS + outbound Cloudflare relay
apps/orchestrator     Loopback orchestration service, REST/SSE/MCP
apps/mcp              stdio MCP bridge to the orchestration service
apps/api-mcp          stdio read-only MCP bridge to the hub API
plugins/clara-policy  OpenCode strict enforcement binding
packages/adapter      Harness adapter installer, shared runner, and MCP registration
packages/adapter-core Harness-neutral adapter client, delivery, prompt, and runner pieces
packages/shared-types Wire frames, actions, states, pairing payloads
packages/api-contract Hub API DTOs, zod schemas, and OpenAPI components
packages/api-client   Fetch-based hub API SDK
packages/api-mcp      Read-only hub API MCP tools
packages/policy       Step policy, budgets, and violation rules
packages/orchestration Package loader, runtime, leases, and watchdog
packages/runner       Shared script runner for harness adapters
packages/devtools     Pipeline preview, diagnostics, and snapshot diff SDK
packages/mcp-server   Shared MCP tools and resources
packages/crypto       device-key derivation, AES-GCM envelopes, replay guard
workers/relay         Cloudflare Worker + RelayRoom Durable Object
lib/std               Standard orchestration packages (software, content, research, diagnostics, maintenance)
```

## Tech stack

- Node 22 (`.nvmrc`), pnpm 11 workspaces
- Vite 8, TypeScript 6, React 19, React Router 8
- Tailwind CSS 4 + shadcn/ui (`radix-nova` preset)
- TanStack Query 5 + a small external chat store
- `@opencode/client@2.1.1` — pinned to the targeted OpenCode server version; used only by the OpenCode adapter and Clara Lab
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
pnpm clara pair     # Print a pairing code
pnpm clara server panel  # Open the hub panel in a browser
pnpm clara start [--local|--docker] [--no-server] [--no-web] [--no-orchestrator] [--build] # Start the stack
pnpm clara stop [--local|--docker] [--no-server] [--no-web] [--no-orchestrator] # Stop the stack
pnpm clara restart [--local|--docker] [--no-server] [--no-web] [--no-orchestrator] [--build] # Restart the stack
pnpm clara status [--no-server] [--no-web] [--no-orchestrator] [--json] # Probe the selected services
pnpm clara logs server|web|orchestrator [--local|--docker] # Follow one service log
pnpm clara server start|stop|restart|status [--json]|panel|pair|admin|logs [--local|--docker] [--build] # Hub service
pnpm clara web start|stop|restart|status [--json]|logs [--local|--docker] [--build] # Web client
pnpm clara orchestrator start|stop|restart [--local|--docker] [--build]|status [--json]|serve # Run the orchestration service
pnpm clara orchestrator analyze [--json] [--days n] # Analyze run history for failure patterns
pnpm clara orchestrator inspect [--run n] [--json] # Read one failed run's evidence
pnpm clara runner   # Run script steps for a workspace (standalone runner)
pnpm clara rebuild  # Snapshot, rebuild, recover services, inspect, and verify health
pnpm clara lab      # Open Clara Lab to preview pipelines and probe the agent
pnpm clara lab check # Validate a package target for CI
pnpm clara docs     # Run the documentation site on :5176
pnpm clara docs build # Build the documentation site
pnpm clara docs check # Check guide and internal doc indexes and links
pnpm clara mcp install|config|status # Install or inspect the MCP bridge
pnpm clara mcp install --api        # Add the read-only hub API MCP
pnpm check:boundaries # Fail if @opencode/client escapes apps/adapter-opencode and apps/lab
pnpm clara adapter install --opencode --pair <code> [--mcp] # Install the OpenCode adapter, MCP, and shared runner
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

## OpenCode server contract

- Clara targets OpenCode 2.1.x and the v2 HTTP API under `/api`.
- The harness SDK is `@opencode/client`, version-matched to the server and used
  only inside `apps/adapter-opencode` and `apps/lab`. Do not swap it for `@opencode-ai/sdk`
  (v1 API) or import `@opencode/sdk` into the browser (embedded Node server).
- The hub API contract in `packages/api-contract` owns the Clara DTOs and
  OpenAPI components. The web, `@clara/api-client`, and `@clara/api-contract`
  must not import or depend on `@opencode/client`. The hub itself has no harness
  SDK; adapters connect out over the Clara Harness Protocol.
- The browser connects only through the hub over the local or relay
  WebSocket, and only to the hub API under `/v1` through `@clara/api-client`.
  The hub service adds OpenCode basic auth; the browser never receives the
  password and has no generic OpenCode proxy.
- Harness adapters are paired from the authenticated hub panel and stored in
  the hub's SQLite database. The adapter discovers OpenCode on its own machine;
  the hub never reads OpenCode's `service.json` or stores the OpenCode password.
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
- Web components live under `apps/web/src/components`; web hooks under
  `apps/web/src/features`. Server code lives under `apps/server/src`.
- Use the shadcn components in `apps/web/src/components/ui`; add new ones with
  `pnpm dlx shadcn@latest add <name>` and keep the generated aliases.
- Path alias: `@/` maps to `apps/web/src/`.
- Prefer `type` imports. No `any`; use the SDK's exported types.
- Keep server state in TanStack Query and live stream state in `chatStore`.
  Invalidate queries from `EventProvider` instead of polling.
- Use `packages/shared-types` for wire types and `packages/crypto` for E2EE.
  Use Clara DTOs from `packages/api-contract` outside the hub service and lab;
  keep OpenCode domain types inside `apps/server` and `apps/lab`.
- The Worker/DO must not parse or persist encrypted payloads.
- Never store credentials outside `sessionStorage`/`localStorage` (the latter
  only when the user opts in). Never commit pairing codes, device keys, tokens, or
  `.env`/`.dev.vars`.
- Keep files focused; split a component once it carries more than one concern.
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

- **User guide** — `apps/docs/guide/`, indexed by
  [apps/docs/guide/index.md](apps/docs/guide/index.md). Written for people using
  or hosting Clara. No source paths, database columns, or internal routes.
- **Internal documentation** — `docs/`, indexed by
  [docs/README.md](docs/README.md). Written for contributors and agents. This is
  the authoritative behavior reference.

The Docusaurus site renders both together: the guide at `/guide/` and the
internal set at `/internals/` behind a visible "Internal" banner. `docs/records/`
is never published.

### User guide

| Before you touch…                    | Read                                                                           |
| ------------------------------------ | ------------------------------------------------------------------------------ |
| Using Clara, pairing, sessions, chat | [apps/docs/guide/index.md](apps/docs/guide/index.md)                           |
| Hosting the hub, Docker, relay       | [apps/docs/guide/self-hosting/index.md](apps/docs/guide/self-hosting/index.md) |

### Internal documentation

| Before you touch…                  | Read                                                             |
| ---------------------------------- | ---------------------------------------------------------------- |
| Writing or updating a feature spec | [docs/features/GUIDE.md](docs/features/GUIDE.md)                 |
| Developer commands and worktrees   | [docs/development.md](docs/development.md)                       |
| Workspace, modes, auth, streaming  | [docs/architecture/overview.md](docs/architecture/overview.md)   |
| Relay Worker, DO, remote access    | [docs/architecture/relay.md](docs/architecture/relay.md)         |
| E2EE, device keys, envelopes       | [docs/architecture/e2ee.md](docs/architecture/e2ee.md)           |
| What ships and what does not       | [docs/features/capabilities.md](docs/features/capabilities.md)   |
| Orchestration service and control  | [docs/features/orchestration.md](docs/features/orchestration.md) |
| Orchestrator diagnosis and fixes   | [docs/features/diagnostics.md](docs/features/diagnostics.md)     |
| Rebuilding and restarting Clara    | [docs/features/maintenance.md](docs/features/maintenance.md)     |
| Pipeline preview and agent probe   | [docs/features/lab.md](docs/features/lab.md)                     |
| Pairing, QR codes, device storage  | [docs/features/pairing.md](docs/features/pairing.md)             |
| Install, updates, offline caching  | [docs/features/install.md](docs/features/install.md)             |
| Connection and credentials         | [docs/features/connection.md](docs/features/connection.md)       |
| Hub panel and local hub state      | [docs/features/panel.md](docs/features/panel.md)                 |
| Project/session browser            | [docs/features/sessions.md](docs/features/sessions.md)           |
| Messages, tools, approvals         | [docs/features/chat.md](docs/features/chat.md)                   |
| Forking, forwarding                | [docs/features/fork.md](docs/features/fork.md)                   |
| Prompt box, commands, mentions     | [docs/features/composer.md](docs/features/composer.md)           |
| Cost, tokens, context              | [docs/features/session-info.md](docs/features/session-info.md)   |
| Inbox notifications and sounds     | [docs/features/notifications.md](docs/features/notifications.md) |
| Keyboard behavior                  | [docs/features/shortcuts.md](docs/features/shortcuts.md)         |
| Everything else                    | [docs/README.md](docs/README.md)                                 |

## Definition of done

1. `pnpm check` passes.
2. `pnpm build` succeeds.
3. The touched screen works against a live OpenCode 2.1.x server, through the
   affected transport.
4. Shipped-scope changes update
   [docs/features/capabilities.md](docs/features/capabilities.md) in the same
   change. User-visible changes also update the matching page under
   `apps/docs/guide/`.
5. No secrets, generated output, or unrelated files are staged.
6. Work is committed as coherent Conventional Commits, each carrying the
   OpenCode and model co-author trailers; `git status` shows only intentionally
   uncommitted follow-up work.
7. The work was done in a task worktree and landed with
   `pnpm task session close`; no task worktree or `task/*` branch remains.
