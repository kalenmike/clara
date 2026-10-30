# Clara

A web client for [OpenCode](https://opencode.ai) sessions: projects, sessions,
streaming chat, agents, models, slash commands, `@` mentions, and live usage.

Clara connects to a running OpenCode 2 server. It does not start one.

## Requirements

- Node 22 (see `.nvmrc`)
- pnpm 11
- A running OpenCode 2.1.x server

## Quick start

```bash
pnpm install
pnpm dev
```

Open <http://localhost:5173>. In development Clara reads the local OpenCode
service from:

```text
${XDG_STATE_HOME:-~/.local/state}/opencode/service.json
```

The Vite dev server proxies `/oc` to that service and attaches the basic-auth
header, so the browser never sees the password. If no local service is found,
use the connect screen with a server URL and password.

### Connecting to another server

1. Start the server with Clara's origin allowed:

   ```bash
   opencode serve --cors http://localhost:5173
   ```

2. Open **Connect**, enter the URL (for example `http://127.0.0.1:4096`) and the
   password from that server's `service.json`.
3. Optionally check "Remember this connection".

Production builds have no proxy; they always use the manual connection.

## Scripts

| Command             | Purpose                                 |
| ------------------- | --------------------------------------- |
| `pnpm dev`          | Vite dev server and local proxy         |
| `pnpm build`        | Type-check and build to `dist/`         |
| `pnpm preview`      | Preview the production build            |
| `pnpm typecheck`    | TypeScript project build                |
| `pnpm lint`         | ESLint                                  |
| `pnpm format`       | Prettier write                          |
| `pnpm format:check` | Prettier check                          |
| `pnpm knip`         | Unused files, exports, and dependencies |
| `pnpm check`        | Typecheck + lint + format check + Knip  |

## Stack

Vite 8 · React 19 · TypeScript 6 · Tailwind CSS 4 · shadcn/ui · TanStack Query 5
· React Router 8 · `@opencode/client` 2.1.1.

`@opencode/client` is pinned to the server minor because the API is generated per
release. See [docs/architecture/overview.md](docs/architecture/overview.md) before
changing it.

## Documentation

Start at [docs/README.md](docs/README.md). Feature specs follow
[docs/features/GUIDE.md](docs/features/GUIDE.md); shipped scope lives in
[docs/features/capabilities.md](docs/features/capabilities.md).

Agent instructions are in [AGENTS.md](AGENTS.md).
