# AGENTS.md — Clara

Clara is a browser client for one running OpenCode server: projects, sessions,
streaming chat, agents, models, commands, mentions, and session usage. This file
is the contract for every AI agent working in this repo.

## Tech stack

- Node 22 (`.nvmrc`), pnpm 11
- Vite 8, TypeScript 6, React 19, React Router 8
- Tailwind CSS 4 + shadcn/ui (`radix-nova` preset)
- TanStack Query 5 + a small external chat store
- `@opencode/client@2.1.1` — pinned to the targeted OpenCode server version

## Commands

```bash
pnpm dev          # Vite dev server on :5173, includes the /oc local proxy
pnpm build        # type-check and production build
pnpm typecheck    # tsc -b
pnpm lint         # ESLint
pnpm format       # Prettier write
pnpm format:check # Prettier check
pnpm knip         # unused files, exports, and dependencies
pnpm check        # typecheck + lint + format:check + knip
```

## OpenCode server contract

- Clara targets OpenCode 2.1.x and the v2 HTTP API under `/api`.
- The SDK package is `@opencode/client`, version-matched to the server. Do not
  swap it for `@opencode-ai/sdk` (v1 API) or import `@opencode/sdk` into the
  browser (embedded Node server).
- Servers require HTTP basic auth: user `opencode`, password from
  `${XDG_STATE_HOME:-~/.local/state}/opencode/service.json`.
- The Vite dev server proxies `/oc` with that password. Production builds use
  manual credentials from the connect screen.
- Session lists are scoped by `directory`, not `project`. Sessions can report
  `projectID: "global"`; always build links from the selected project ID.

Read [docs/architecture/overview.md](docs/architecture/overview.md) before
changing connection, auth, streaming, or version pins.

## Conventions

- Components live under `src/components`; server hooks under `src/features`.
- Use the shadcn components in `src/components/ui`; add new ones with
  `pnpm dlx shadcn@latest add <name>` and keep the generated aliases.
- Path alias: `@/` maps to `src/`.
- Prefer `type` imports. No `any`; use the SDK's exported types.
- Keep server state in TanStack Query and live stream state in `chatStore`.
  Invalidate queries from `EventProvider` instead of polling.
- Never store credentials outside `sessionStorage`/`localStorage` (the latter
  only when the user opts in). Never commit them.
- Keep files focused; split a component once it carries more than one concern.

## Documentation map

| Before you touch…                    | Read                                                             |
| ------------------------------------ | ---------------------------------------------------------------- |
| Writing or updating a feature spec   | [docs/features/GUIDE.md](docs/features/GUIDE.md)                 |
| Stack, auth, streaming, version pins | [docs/architecture/overview.md](docs/architecture/overview.md)   |
| What ships and what does not         | [docs/features/capabilities.md](docs/features/capabilities.md)   |
| Connection and credentials           | [docs/features/connection.md](docs/features/connection.md)       |
| Project/session browser              | [docs/features/sessions.md](docs/features/sessions.md)           |
| Messages, tools, approvals           | [docs/features/chat.md](docs/features/chat.md)                   |
| Prompt box, commands, mentions       | [docs/features/composer.md](docs/features/composer.md)           |
| Cost, tokens, context                | [docs/features/session-info.md](docs/features/session-info.md)   |
| Inbox notifications and sounds       | [docs/features/notifications.md](docs/features/notifications.md) |
| Keyboard behavior                    | [docs/features/shortcuts.md](docs/features/shortcuts.md)         |
| Everything else                      | [docs/README.md](docs/README.md)                                 |

## Definition of done

1. `pnpm check` passes.
2. `pnpm build` succeeds.
3. The touched screen works against a live OpenCode 2.1.x server.
4. Shipped-scope changes update
   [docs/features/capabilities.md](docs/features/capabilities.md) in the same
   change.
5. No secrets, generated output, or unrelated files are staged.
