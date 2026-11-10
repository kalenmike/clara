# Clara

A secure web client for [OpenCode](https://opencode.ai) sessions: projects,
sessions, streaming chat, agents, models, slash commands, `@` mentions, and live
usage. Clara reaches a home OpenCode server through an end-to-end encrypted
WebSocket, either through the Cloudflare relay or over a local connection on a
trusted network.

## Requirements

- Node 22 (see `.nvmrc`)
- pnpm 11
- A running OpenCode 2.1.x server
- Optional: a Cloudflare account and your own domain for remote access

## Workspace

```text
apps/web              React/Vite SPA, deployed to Cloudflare Pages or the web container
apps/panel            Authenticated dashboard and setup surface served by the home agent
apps/server           Node home agent, harness proxy, local WS + outbound relay
apps/orchestrator     Loopback orchestration service, REST/SSE/MCP
apps/mcp              stdio MCP bridge to the orchestration service
plugins/clara-policy  OpenCode strict enforcement binding
packages/adapter      Harness adapter installer, shared runner, and MCP registration
packages/adapter-core Harness-neutral adapter client, delivery, prompt, and runner pieces
packages/shared-types Wire frames, actions, states, pairing payloads
packages/orchestration Package loader, runtime, leases, and watchdog
packages/runner       Shared script runner for harness adapters
packages/crypto       PSK derivation, AES-GCM envelopes, replay guard
workers/relay         Cloudflare Worker + RelayRoom Durable Object
```

## Development workflow

All new work happens in a task worktree under `../clara-worktrees`:

```bash
pnpm task session start my-change
# move the session to ../clara-worktrees/my-change, or cd there
pnpm check && pnpm build
pnpm task session close my-change
```

Run `start` and `close` from the primary checkout. `start` creates branch
`task/my-change` and installs dependencies; `close` refuses uncommitted work,
runs the checks and build, merges into the primary `HEAD`, then removes the
worktree and branch. See [docs/development.md](docs/development.md).

## Quick start

```bash
pnpm install
opencode service start      # or: opencode serve
pnpm dev                    # web on :5173 and the home agent on :8788
pnpm clara pair             # print a pairing code for the connect screen
```

Open <http://localhost:5173> and pair with the code from `pnpm clara pair`. The
home agent does **not** read OpenCode's `service.json`; it reads the harness
connection saved in the authenticated panel.

First run:

1. Start the agent (`pnpm dev` or `pnpm clara serve`).
2. Open the panel at <http://127.0.0.1:8790>.
3. Read the one-time setup token from `~/.config/clara/admin-setup.txt` or run
   `pnpm clara server setup-token` (add `--docker` for the container).
4. Choose the superadmin password, then add the OpenCode base URL and password.
   Inside a container, use `http://opencode:4096` or another name reachable from
   the `clara` network, not `127.0.0.1`.

The harness is saved in SQLite with its secret encrypted at rest. The web client
does not need to change.

### Agent panel

The home agent serves an authenticated dashboard and setup surface on its own
listener. In development, run the API and the panel separately:

```bash
pnpm dev:server
pnpm dev:panel   # http://localhost:5174
```

In a production build, the panel ships inside the agent and is available at
<http://127.0.0.1:8790> after `pnpm build` and `pnpm clara serve`. Run
`pnpm clara control` to open it: the command starts the built agent when it is
not already serving the panel, opens the URL in a browser, and stays attached
so the agent logs remain visible. The panel never travels through the relay.
From it you can configure the OpenCode harness, disable the harness connection,
local transport, relay, or push, start and stop the local orchestration service,
and stop every external connection while the process, panel, and database stay
alive. Settings and harness connections are stored at `CLARA_DB_PATH` or
`~/.local/share/clara/clara.db` (mode `0600`); harness passwords are encrypted
with `secrets.key`. The panel never returns the PSK, harness password, relay
tokens, push endpoints, sync values, or file contents. See
[docs/features/panel.md](docs/features/panel.md) and
[docs/features/agent-controls.md](docs/features/agent-controls.md).

### Server container

Docker is optional. The local foreground mode above stays the default.

```bash
docker network create clara      # once, or reuse the orchestrator stack
pnpm clara server start --docker --build
pnpm clara server status
pnpm clara server setup-token --docker
pnpm clara server pair --docker
```

The server joins the same `clara` network as the orchestrator and OpenCode. Its
panel and local WebSocket are published on host loopback only. Use an SSH tunnel
for remote panel access; the panel's `Host`/`Origin` guard still expects a
loopback origin. Do not publish plain HTTP on the LAN. See
[docs/features/connection.md](docs/features/connection.md) and
[docs/features/panel.md](docs/features/panel.md).

Existing installs that keep their databases under `~/.config/clara` should stop
the agent and OpenCode, then move them once:

```bash
mkdir -p ~/.local/share/clara
mv ~/.config/clara/clara.db* ~/.local/share/clara/
```

### Web container

The built SPA can be served locally instead of Cloudflare Pages:

```bash
docker network create clara      # once, or reuse the server stack
pnpm clara web start --docker --build
pnpm clara web status
```

Open <http://127.0.0.1:8080>. The image builds the same bundle as
`pnpm --filter @clara/web build` and serves it with nginx on host loopback; the
Pages headers and cache rules are mirrored in `docker/web.nginx.conf`.

Pairing mode comes from the agent, not the web image. `pnpm clara server pair
--docker` prints a relay code when the agent has a relay configured and a local
code otherwise; add `--local` to force a local code. The relay code already
carries its `wss://…/room/<id>` URL, so `VITE_CLARA_WS_URL` is only needed when
the browser must use a different relay endpoint than the agent:

```bash
VITE_CLARA_WS_URL=wss://relay.example pnpm clara web start --docker --build
```

The default pairing base is `http://127.0.0.1:8080`, so a local code prints a
link to this container. Set `CLARA_PAIRING_BASE_URL` to your own HTTPS web URL
for Pages or a remote deployment.

Local pairing works from `http://127.0.0.1:8080` or an SSH tunnel. An HTTPS page
cannot open a `ws://` socket, so phones and remote browsers still need the relay.
The container is static and the browser talks to the home agent directly; it
does not proxy API or WebSocket traffic. See
[docs/features/install.md](docs/features/install.md) and
[docs/features/connection.md](docs/features/connection.md).

### Local WebSocket mode

Pair with the local agent directly:

```bash
pnpm clara pair
```

The pairing payload carries the agent's own `ws://127.0.0.1:8788/ws` URL, so no
build-time endpoint is needed. Scan the QR or paste the code on the connect
screen. Local mode still uses E2EE; it does not fall back to plaintext.

Add `--local` (`pnpm clara pair --local`) to force a local-only
code even when the agent has a relay configured. The local listener runs
alongside the relay client, so this exercises the WebSocket transport — including
the shell policy — without sending traffic through Cloudflare. For the dev app,
set `CLARA_PAIRING_BASE_URL=http://localhost:5173` when pairing so the printed
link opens Vite directly.

A `local` pairing code only works where that URL is reachable, and an HTTPS page
cannot open a `ws://` socket. For phones, configure the relay instead.

### Relay mode

1. Deploy the Worker once:

   ```bash
   cd workers/relay
   pnpm exec wrangler secret put CLARA_AGENT_TOKEN
   pnpm exec wrangler secret put CLARA_CLIENT_TOKEN
   cd ../..
   pnpm deploy:relay
   ```

2. Build the web app with:

   ```bash
   VITE_CLARA_WS_URL=wss://relay.example pnpm --filter @clara/web build
   ```

   Use your own relay host. `pnpm deploy:web` reads `VITE_CLARA_WS_URL` from the
   environment the same way.

3. Deploy `apps/web/dist` to your Pages project and attach your own domain.

4. Configure the home agent. The systemd unit reads
   `~/.config/clara/server.env` (`KEY=value`, mode `0600`) and restarts with it;
   a hand-started agent needs the same variables exported:

   ```bash
   CLARA_RELAY_URL=wss://relay.example
   CLARA_PAIRING_BASE_URL=https://your-clara.example
   CLARA_RELAY_ROOM=<generated on first run, persisted in server.json>
   CLARA_AGENT_TOKEN=<must match the Worker secret>
   CLARA_CLIENT_TOKEN=<must match the Worker secret>
   ```

   Use your own relay and web URLs. The pairing base defaults to the local web
   container, so set it explicitly for a Pages deployment.

5. Restart the agent and check `relay connecting` / `relay online` in its log.
   `pnpm clara pair` must then print a random `Room:` and a `/room/<id>` link;
   a `Room: local` code is local-only and cannot work through the relay.

   The relay URL and room are persisted in `~/.config/clara/server.json`, but the
   two tokens are environment-only and never written there. Missing tokens stop
   the agent at startup with an error naming the missing variable.

`VITE_CLARA_WS_URL` is the relay deployment switch: it retargets relay-room
pairings and is ignored for `local` pairing codes. When unset, the pairing
payload's URL is used. See
[docs/architecture/relay.md](docs/architecture/relay.md) for the full topology.

## Push notifications

When Clara is connected through the home agent, **Settings → Notifications** can
enable Web Push. The agent generates a VAPID key pair on first run and stores
subscriptions at `~/.config/clara/subscriptions.json`.

- On iPhone and iPad, add Clara to the Home Screen from Safari and open it from
  that icon before enabling push.
- Brave on desktop needs **Use Google services for push messaging** enabled at
  `brave://settings/privacy`; Brave has no push service of its own, so
  subscribing fails until that setting is on and the browser is relaunched.
- The agent must be able to reach the browser vendor's push service over HTTPS.
- `pnpm clara pair --rotate` clears all stored push
  subscriptions as well as rotating the pairing key; restart the running home
  agent afterward.
- `CLARA_VAPID_SUBJECT` overrides the VAPID contact subject; the default is the
  pairing base URL.
- Test push from a production build with the home agent URL
  (`VITE_CLARA_WS_URL=ws://127.0.0.1:8788 pnpm build && pnpm preview`) or the
  deployed PWA; the Vite dev server does not enable the service worker.

## Client settings sync

The agent can store non-secret browser preferences for paired devices, with
per-namespace revisions, deletes, and size limits over the E2EE session. The
storage and protocol exist; the web client does not sync settings yet and there
is no UI for it. See [docs/features/sync.md](docs/features/sync.md).

## Scripts

| Command                    | Purpose                                                     |
| -------------------------- | ----------------------------------------------------------- |
| `pnpm task session start`  | Create a task worktree under `../clara-worktrees`           |
| `pnpm task session list`   | List task worktrees                                         |
| `pnpm task session close`  | Check, merge, and remove a task worktree                    |
| `pnpm dev`                 | Web dev server and home agent                               |
| `pnpm dev:web`             | Web only                                                    |
| `pnpm dev:panel`           | Agent panel dev server                                      |
| `pnpm dev:server`          | Home agent only                                             |
| `pnpm dev:relay`           | Local `wrangler dev` for the Worker/DO                      |
| `pnpm build`               | Build every workspace package                               |
| `pnpm clara pair`          | Print a pairing code                                        |
| `pnpm clara control`       | Serve the built panel and open it in a browser              |
| `pnpm clara serve`         | Run the built home agent                                    |
| `pnpm clara server`        | Start, stop, inspect, pair, or reset the server container   |
| `pnpm clara pass`          | Print the local OpenCode server password                    |
| `pnpm clara orchestration` | Start, stop, analyze, or inspect the orchestration service  |
| `pnpm clara runner`        | Run script steps for a workspace                            |
| `pnpm clara rebuild`       | Rebuild Clara, recover services, inspect, and verify health |
| `pnpm test`                | Run crypto, protocol, server, web, and Worker tests         |
| `pnpm check`               | Typecheck + lint + format + Knip + tests                    |
| `pnpm commitlint`          | Lint the last commit message                                |
| `pnpm deploy:web`          | Build and deploy the Pages project                          |
| `pnpm deploy:relay`        | Deploy the Worker and DO migration                          |
| `pnpm format`              | Prettier write                                              |
| `pnpm format:check`        | Prettier check                                              |

## Security

- Cloudflare sees ciphertext and routing metadata only.
- The browser never receives the OpenCode password in relay mode.
- The PSK is delivered in a URL fragment, stored in browser storage, and kept
  at `~/.config/clara/server.json` (mode `0600`) on the agent.
- Web Push subscriptions live at `~/.config/clara/subscriptions.json`; VAPID
  keys live at `~/.config/clara/vapid.json`. Both use mode `0600`.
- Agent settings, client sync data, and harness connections live in
  `~/.local/share/clara/clara.db` (mode `0600`). Harness passwords are encrypted
  with `secrets.key` (mode `0600`) or `CLARA_SECRET_KEY`; the database alone does
  not expose them. Push endpoints and sync secrets remain in their existing
  files.
- The agent panel requires a superadmin login. It listens on `127.0.0.1:8790`
  by default, guards every request with Host/Origin/fetch-metadata checks, and
  keeps the setup token in `admin-setup.txt` (mode `0600`) until the first login.
  It never returns the PSK, harness password, relay tokens, push endpoints, sync
  values, or file contents. It is not exposed through the relay or Pages.
- A lost panel password is reset with `pnpm clara server admin reset` (add
  `--docker` in a container). That command writes a new one-time setup token.
  There is deliberately no network password-reset endpoint.
- Never commit `.env`, `.dev.vars`, `service.json`, push subscriptions, VAPID
  keys, pairing codes, tokens, the PSK, `secrets.key`, or `admin-setup.txt`.
- Rotate with `pnpm clara pair --rotate`; this also clears
  every stored push subscription.

See [docs/architecture/e2ee.md](docs/architecture/e2ee.md).

## Stack

Vite 8 · React 19 · TypeScript 6 · Tailwind CSS 4 · shadcn/ui · TanStack Query 5
· React Router 8 · `@opencode/client` 2.1.1 · Node 22 · `ws` · Cloudflare
Workers/Durable Objects.

`@opencode/client` is pinned to the server minor because the API is generated per
release. See [docs/architecture/overview.md](docs/architecture/overview.md).

## Documentation

Start at [docs/README.md](docs/README.md). Feature specs follow
[docs/features/GUIDE.md](docs/features/GUIDE.md); shipped scope lives in
[docs/features/capabilities.md](docs/features/capabilities.md).

Agent instructions are in [AGENTS.md](AGENTS.md).
