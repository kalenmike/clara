# AGENTS.md — Clara

Clara is a browser/PWA client for one running OpenCode server, plus a Node home
agent that carries the OpenCode HTTP/SSE API over an end-to-end encrypted
WebSocket. This file is the contract for every AI agent working in this repo.

## Workspace

```text
apps/web              React/Vite SPA (Cloudflare Pages)
apps/server           Node home agent, local WS + outbound Cloudflare relay
packages/shared-types Wire frames, actions, states, pairing payloads
packages/crypto       PSK derivation, AES-GCM envelopes, replay guard
workers/relay         Cloudflare Worker + RelayRoom Durable Object
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
pnpm dev          # Web on :5173 and the home agent on :8788
pnpm dev:web      # Web only
pnpm dev:server   # Home agent only
pnpm dev:relay    # Local wrangler dev for the Worker/DO
pnpm build        # Build every workspace package
pnpm typecheck    # tsc -b
pnpm lint         # ESLint
pnpm format       # Prettier write
pnpm format:check # Prettier check
pnpm test         # All package tests
pnpm knip         # Unused files, exports, and dependencies
pnpm check        # typecheck + lint + format:check + knip + test
pnpm deploy:web   # Pages deploy
pnpm deploy:relay # Worker deploy
```

## OpenCode server contract

- Clara targets OpenCode 2.1.x and the v2 HTTP API under `/api`.
- The SDK package is `@opencode/client`, version-matched to the server. Do not
  swap it for `@opencode-ai/sdk` (v1 API) or import `@opencode/sdk` into the
  browser (embedded Node server).
- In direct mode the browser sends HTTP basic auth with the `opencode` user.
  In relay/local mode the home agent adds basic auth; the browser never receives
  the password.
- The agent reads `${XDG_STATE_HOME:-~/.local/state}/opencode/service.json` when
  `CLARA_OPENCODE_URL` / `CLARA_OPENCODE_PASSWORD` are unset.
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

## Documentation map

| Before you touch…                  | Read                                                             |
| ---------------------------------- | ---------------------------------------------------------------- |
| Writing or updating a feature spec | [docs/features/GUIDE.md](docs/features/GUIDE.md)                 |
| Workspace, modes, auth, streaming  | [docs/architecture/overview.md](docs/architecture/overview.md)   |
| Relay Worker, DO, remote access    | [docs/architecture/relay.md](docs/architecture/relay.md)         |
| E2EE, PSK, envelopes, rotation     | [docs/architecture/e2ee.md](docs/architecture/e2ee.md)           |
| What ships and what does not       | [docs/features/capabilities.md](docs/features/capabilities.md)   |
| Pairing, QR codes, device storage  | [docs/features/pairing.md](docs/features/pairing.md)             |
| Connection and credentials         | [docs/features/connection.md](docs/features/connection.md)       |
| Project/session browser            | [docs/features/sessions.md](docs/features/sessions.md)           |
| Messages, tools, approvals         | [docs/features/chat.md](docs/features/chat.md)                   |
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
