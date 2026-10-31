# Clara

A web client for [OpenCode](https://opencode.ai) sessions: projects, sessions,
streaming chat, agents, models, slash commands, `@` mentions, and live usage.

Clara connects to a running OpenCode 2 server. It does not start one.

## Requirements

- Node 22 (see `.nvmrc`)
- pnpm 11
- A running OpenCode 2.1.x server

## Quick start

Start OpenCode as a background service, then start Clara:

```bash
opencode service start
pnpm install
pnpm dev
```

Open <http://localhost:5173>. `opencode service start` registers the server URL
and password in:

```text
${XDG_STATE_HOME:-~/.local/state}/opencode/service.json
```

The Vite dev server reads that file and proxies `/oc` to the service with the
basic-auth header, so the browser never sees the password. Check the service
with `opencode service status` and stop it with `opencode service stop`.

### Two ways to start OpenCode

| Command                          | Server                                                                                             | How Clara connects                                                                                                       |
| -------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `opencode service start`         | Background service, registered in `service.json` (port `49374` by default on the `latest` channel) | Automatically through the `/oc` proxy. No URL, password, or CORS configuration needed.                                   |
| `opencode serve --cors <origin>` | Foreground server on `127.0.0.1:4096` by default                                                   | Manually from **Connect**: enter the URL and the `server password …` printed at startup. CORS must allow Clara's origin. |

`opencode serve` does not write `service.json`, so Clara's proxy cannot discover
it. `opencode service start` is the command that registers a server for
automatic detection.

### Connecting to a foreground or remote server

1. Start the server with Clara's origin allowed:

   ```bash
   opencode serve --cors http://localhost:5173
   ```

   Repeat `--cors` for each origin Clara uses, for example
   `--cors http://localhost:4173` for `pnpm preview` or
   `--cors http://127.0.0.1:5173` when Clara is opened by IP.

2. Open **Connect**, enter the URL (for example `http://127.0.0.1:4096`) and the
   password printed by `opencode serve` as `server password …`.
3. Optionally check "Remember this connection".

Production builds have no proxy; they always use the manual connection.
`pnpm preview` still includes the local proxy.

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
