# AGENTS.md — Clara

Clara is a browser/PWA client for one running OpenCode server, plus a Node home
agent that carries the OpenCode HTTP/SSE API over an end-to-end encrypted
WebSocket. This file is the contract for every AI agent working in this repo.

## Workspace

```text
apps/web              React/Vite SPA (Cloudflare Pages)
apps/panel            Authenticated home-agent dashboard and setup surface
apps/lab              Loopback pipeline preview and agent probe
apps/server           Node home agent, local WS + outbound Cloudflare relay
apps/orchestrator     Loopback orchestration service, REST/SSE/MCP
apps/mcp              stdio MCP bridge to the orchestration service
plugins/clara-policy  OpenCode strict enforcement adapter
packages/shared-types Wire frames, actions, states, pairing payloads
packages/policy       Step policy, budgets, and violation rules
packages/orchestration Package loader, runtime, leases, and watchdog
packages/runner       Shared script runner for harness adapters
packages/devtools     Pipeline preview, diagnostics, and snapshot diff SDK
packages/mcp-server   Shared MCP tools and resources
packages/crypto       PSK derivation, AES-GCM envelopes, replay guard
workers/relay         Cloudflare Worker + RelayRoom Durable Object
lib/std               Standard orchestration packages (software, content, research, diagnostics, maintenance)
```

## Tech stack

- Node 22 (`.nvmrc`), pnpm 11 workspaces
- Vite 8, TypeScript 6, React 19, React Router 8
- Tailwind CSS 4 + shadcn/ui (`radix-nova` preset)
- TanStack Query 5 + a small external chat store
- `@opencode/client@2.1.1` — pinned to the targeted OpenCode server version
- `ws`, WebCrypto, Cloudflare Workers/Durable Objects, Wrangler

## Commands

```bash
pnpm task session start <name> # Create a worktree under ../clara-worktrees
pnpm task session list         # List task worktrees
pnpm task session close <name> # Check, merge, and remove a task worktree
pnpm dev            # Web on :5173 and the home agent on :8788
pnpm dev:web        # Web only
pnpm dev:panel      # Agent panel only
pnpm dev:lab        # Clara Lab (Vite :5175, lab server :8791)
pnpm dev:server     # Home agent only
pnpm dev:relay      # Local wrangler dev for the Worker/DO
pnpm build          # Build every workspace package
pnpm clara pair     # Print a pairing code
pnpm clara control  # Serve the built panel and open it in a browser
pnpm clara serve    # Run the built home agent
pnpm clara server start|stop|status|pair|admin [--docker] # Home agent container
pnpm clara pass     # Print the local OpenCode password
pnpm clara orchestration start [--docker] [--build]|stop [--docker]|status|serve # Run the orchestration service
pnpm clara orchestration analyze [--json] [--days n] # Analyze run history for failure patterns
pnpm clara orchestration inspect [--run n] [--json] # Read one failed run's evidence
pnpm clara runner   # Run script steps for a workspace (standalone runner)
pnpm clara rebuild  # Snapshot, rebuild, recover services, inspect, and verify health
pnpm clara lab      # Open Clara Lab to preview pipelines and probe the agent
pnpm clara lab check # Validate a package target for CI
pnpm clara mcp install|config|status # Install or inspect the MCP bridge
pnpm clara adapter install opencode # Install the OpenCode strict adapter
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
- The SDK package is `@opencode/client`, version-matched to the server. Do not
  swap it for `@opencode-ai/sdk` (v1 API) or import `@opencode/sdk` into the
  browser (embedded Node server).
- In direct mode the browser sends HTTP basic auth with the `opencode` user.
  In relay/local mode the home agent adds basic auth; the browser never receives
  the password.
- Harness connections are configured in the authenticated agent panel and
  stored in the home agent's SQLite database. The server does not read OpenCode's
  `service.json`, and it does not read a fixed OpenCode URL or password from the
  environment.
- Session lists are scoped by `directory`, not `project`. Sessions can report
  `projectID: "global"`; always build links from the selected project ID.
- The Vite dev server still proxies `/oc` for direct mode.

Read [docs/architecture/overview.md](docs/architecture/overview.md) before
changing connection, auth, streaming, or version pins. Read
[docs/architecture/relay.md](docs/architecture/relay.md) and
[docs/architecture/e2ee.md](docs/architecture/e2ee.md) before changing the
transport, Worker, Durable Object, or crypto.

## Conventions

- Web components live under `apps/web/src/components`; web hooks under
  `apps/web/src/features`. Server code lives under `apps/server/src`.
- Use the shadcn components in `apps/web/src/components/ui`; add new ones with
  `pnpm dlx shadcn@latest add <name>` and keep the generated aliases.
- Path alias: `@/` maps to `apps/web/src/`.
- Prefer `type` imports. No `any`; use the SDK's exported types.
- Keep server state in TanStack Query and live stream state in `chatStore`.
  Invalidate queries from `EventProvider` instead of polling.
- Use `packages/shared-types` for wire types and `packages/crypto` for E2EE.
  Keep OpenCode domain types sourced from `@opencode/client`.
- The Worker/DO must not parse or persist encrypted payloads.
- Never store credentials outside `sessionStorage`/`localStorage` (the latter
  only when the user opts in). Never commit pairing codes, PSKs, tokens, or
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

| Before you touch…                  | Read                                                             |
| ---------------------------------- | ---------------------------------------------------------------- |
| Writing or updating a feature spec | [docs/features/GUIDE.md](docs/features/GUIDE.md)                 |
| Developer commands and worktrees   | [docs/development.md](docs/development.md)                       |
| Workspace, modes, auth, streaming  | [docs/architecture/overview.md](docs/architecture/overview.md)   |
| Relay Worker, DO, remote access    | [docs/architecture/relay.md](docs/architecture/relay.md)         |
| E2EE, PSK, envelopes, rotation     | [docs/architecture/e2ee.md](docs/architecture/e2ee.md)           |
| What ships and what does not       | [docs/features/capabilities.md](docs/features/capabilities.md)   |
| Orchestration service and control  | [docs/features/orchestration.md](docs/features/orchestration.md) |
| Orchestrator diagnosis and fixes   | [docs/features/diagnostics.md](docs/features/diagnostics.md)     |
| Rebuilding and restarting Clara    | [docs/features/maintenance.md](docs/features/maintenance.md)     |
| Pipeline preview and agent probe   | [docs/features/lab.md](docs/features/lab.md)                     |
| Pairing, QR codes, device storage  | [docs/features/pairing.md](docs/features/pairing.md)             |
| Install, updates, offline caching  | [docs/features/install.md](docs/features/install.md)             |
| Connection and credentials         | [docs/features/connection.md](docs/features/connection.md)       |
| Agent panel and local server state | [docs/features/panel.md](docs/features/panel.md)                 |
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
   change.
5. No secrets, generated output, or unrelated files are staged.
6. Work is committed as coherent Conventional Commits, each carrying the
   OpenCode and model co-author trailers; `git status` shows only intentionally
   uncommitted follow-up work.
7. The work was done in a task worktree and landed with
   `pnpm task session close`; no task worktree or `task/*` branch remains.
