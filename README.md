# Clara

A secure web client for [OpenCode](https://opencode.ai) sessions: projects,
sessions, streaming chat, agents, models, slash commands, `@` mentions, and live
usage. Clara reaches an OpenCode server through an end-to-end encrypted
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
apps/panel            Authenticated hub panel and setup surface served by the hub service
apps/server           Node hub service, /v1 API, harness proxy, local WS + outbound relay
apps/orchestrator     Loopback orchestration service, REST/SSE/MCP
apps/mcp              stdio MCP bridge to the orchestration service
apps/api-mcp          stdio read-only MCP bridge to the hub API
apps/adapter-opencode  OpenCode harness adapter, binding, and standalone bin
packages/adapter      Harness-neutral adapter runtime, supervision, and enrollment
packages/binding-core Orchestration binding client, delivery, prompt, and usage
packages/shared-types Wire frames, actions, states, pairing payloads
packages/api-contract Hub API schemas and generated OpenAPI components
packages/api-client   Fetch-based hub API SDK
packages/api-mcp      Read-only hub API MCP tools
packages/orchestration Package loader, runtime, leases, and watchdog
packages/runner       Shared script runner for harness adapters
packages/crypto       device-key derivation, AES-GCM envelopes, replay guard
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

## Fast setup

With OpenCode 2.1.x running, a local checkout needs:

```bash
pnpm install
pnpm clara start --local --build
pnpm clara server setup-token --local
pnpm clara server panel
# In the panel: choose the superadmin password and save the OpenCode URL/password.
pnpm clara pair --local --no-relay
# Open http://127.0.0.1:8080 and pair.
```

On a fresh install, `setup-token` prints the one-time token. Skip it if the
panel already has an admin.

For Docker, use `pnpm clara start --build` and
`pnpm clara server setup-token --docker`. Add `--no-relay` for a same-machine
code; use `pnpm clara pair` without `--no-relay` for a relay pairing on a phone
or another device.

For orchestration only, install the harness adapter after the stack is up:

```bash
pnpm clara adapter install --opencode
```

Only the OpenCode adapter is installable today.

The hub does **not** read OpenCode's `service.json`; it reads the harness
connection saved in the authenticated panel. The harness is saved in SQLite with
its secret encrypted at rest. See [First run](#first-run) for the token file
and container networking details.

## Development quick start

```bash
pnpm install
opencode service start      # or: opencode serve
pnpm dev                    # web on :5173 and the hub service on :8788
pnpm clara pair             # print a pairing code for the connect screen
```

Open <http://localhost:5173> and pair with the code from `pnpm clara pair`.

### First run

1. Start the hub (`pnpm dev` or `pnpm clara server start --local`).
2. Open the panel at <http://127.0.0.1:8790>, or run `pnpm clara server panel`.
3. Read the one-time setup token from `~/.config/clara/admin-setup.txt` or run
   `pnpm clara server setup-token` (add `--docker` for the container).
4. Choose the superadmin password, then add the OpenCode base URL and password.
   Inside a container, use `http://opencode:4096` or another name reachable from
   the `clara` network, not `127.0.0.1`.

### Hub panel

The hub service serves an authenticated dashboard and setup surface on its own
listener. In development, run the API and the panel separately:

```bash
pnpm dev:server
pnpm dev:panel   # http://localhost:5174
```

In a production build, the panel ships inside the hub service and is available at
<http://127.0.0.1:8790> after `pnpm build` and `pnpm clara server start --local`.
Run `pnpm clara server panel` to open it in a browser; the command only opens a
panel that is already being served. The panel never travels through the relay.
From it you can configure the OpenCode harness, disable the harness connection,
local transport, relay, or push, start and stop the local orchestration service,
and stop every external connection while the process, panel, and database stay
alive. Settings and harness connections are stored at `CLARA_DB_PATH` or
`~/.local/share/clara/clara.db` (mode `0600`); harness passwords are encrypted
with `secrets.key`. The panel never returns device keys, harness password, relay
tokens, push endpoints, sync values, or file contents. See
[docs/features/panel.md](docs/features/panel.md) and
[docs/features/hub-controls.md](docs/features/hub-controls.md).

### Hub API

The hub serves its versioned API on the local listener (default
<http://127.0.0.1:8788>). Swagger UI is at `/docs` and the OpenAPI document is at
`/openapi.json`. The browser reaches the same API over the E2EE WebSocket; local
tools use the bearer token stored in `api.token` in the hub config directory.

Install the read-only API MCP for agents testing frontend code against live
data:

```bash
pnpm clara mcp install --api
```

The MCP reads `CLARA_API_URL` and `CLARA_API_TOKEN_FILE`. See
[docs/architecture/api.md](docs/architecture/api.md).

### Docker stack

Docker is optional. The local foreground mode above stays the default.

```bash
pnpm clara start --build
pnpm clara status
pnpm clara restart
pnpm clara stop
```

`start` brings up the orchestrator, the hub (with its panel), and the web
client, creates the `clara` network, and writes `docker/.env` with a random
orchestration token on first run. The containers are named `clara-orchestrator`,
`clara-server`, and `clara-web`. Disable any part with `--no-orchestrator`,
`--no-server`, or `--no-web`; combine them when needed:

```bash
pnpm clara start --no-web
pnpm clara start --no-server --no-web
pnpm clara start --build --no-orchestrator
```

`restart` stops and recreates the selected containers, so it applies image and
environment changes. Add `--build` to rebuild first. `stop` is stack-wide; use
the scoped commands below to control one service.

Docker state lives in named volumes, never in the local install directories:

| Volume                    | Contents                                                                            |
| ------------------------- | ----------------------------------------------------------------------------------- |
| `clara-server-config`     | `server.json`, `vapid.json`, `subscriptions.json`, `secrets.key`, `admin-setup.txt` |
| `clara-server-data`       | `clara.db`                                                                          |
| `clara-orchestrator-data` | `orchestration.db` and the container token                                          |

Only the workspace is a host bind. Set `CLARA_SERVER_CONFIG_DIR`,
`CLARA_SERVER_DATA_DIR`, or `CLARA_ORCHESTRATOR_DATA_DIR` in `docker/.env` to an
absolute host path when you want to bind one of those states instead. Local
installs (`pnpm clara start --local`, `pnpm dev`, and
`pnpm clara orchestrator start --local`) keep using `~/.config/clara` and
`~/.local/share/clara`; they never read `docker/.env` or the Docker volumes. See
[docs/development.md](docs/development.md#local-and-docker-state) for the full
state map and the one-time migration.

Archive and restore the Docker volumes with the stack stopped:

```bash
pnpm clara stop
pnpm clara backup --output ~/clara-backup.tar.gz
pnpm clara restore ~/clara-backup.tar.gz --force
pnpm clara start
```

`restore` refuses to overwrite existing volumes without `--force`, and
`docker compose down -v` deletes them.

`status` uses one table for every service, shows the container name and whether
the endpoint answers, and exits nonzero when any selected service is not
running. It accepts the same `--no-server`, `--no-web`, and `--no-orchestrator`
selection as `start`, plus `--json`:

```text
Clara stack

SERVICE       CONTAINER            STATE                URL
orchestrator  clara-orchestrator   running (container)  http://127.0.0.1:8789
server        clara-server         running (container)  http://127.0.0.1:8788
web           clara-web            running (container)  http://127.0.0.1:8080

Details
  orchestrator  database: Docker volume clara-orchestrator-data; pid: none
  server        panel: http://127.0.0.1:8790 (running); admin: configured
  web           kind: static SPA
```

`pnpm clara status --json` prints `{ "ok": true, "services": [...] }` with the
same record for each service. The scoped
`pnpm clara server status --json`, `pnpm clara web status --json`, and
`pnpm clara orchestrator status --json` commands print one record with the same
shape. For the server record, `url` is the local listener and `details.panel`
holds the panel URL.

### Hub container

The hub can also run on its own. Docker is the default; `--local` runs
the built hub service as a detached local process:

```bash
pnpm clara server start --build
pnpm clara server start --local --build
pnpm clara server status
pnpm clara server setup-token --docker
pnpm clara server pair --docker
```

The hub service joins the same `clara` network as the orchestrator and OpenCode. Its
panel and local WebSocket are published on host loopback only. Use an SSH tunnel
for remote panel access; the panel's `Host`/`Origin` guard still expects a
loopback origin. Do not publish plain HTTP on the LAN. See
[docs/features/connection.md](docs/features/connection.md) and
[docs/features/panel.md](docs/features/panel.md).

Local installs that keep their databases under `~/.config/clara` should stop
the hub and OpenCode, then move them once. Docker installs do not use these
directories; use the volume migration guide instead.

```bash
mkdir -p ~/.local/share/clara
mv ~/.config/clara/clara.db* ~/.local/share/clara/
```

### Web container

The built SPA can be served locally instead of Cloudflare Pages. It starts with
`pnpm clara start`, or on its own with:

```bash
pnpm clara web start --docker --build
pnpm clara web status
pnpm clara web stop --docker
```

Open <http://127.0.0.1:8080>. The image builds the same bundle as
`pnpm --filter @clara/web build` and serves it with nginx on host loopback; the
Pages headers and cache rules are mirrored in `docker/web.nginx.conf`.

Pairing mode comes from the hub, not the web image. `pnpm clara server pair
--docker` prints a relay code when the hub has a relay configured and a local
code otherwise; add `--no-relay` to force a local code and print the local web
app link. The relay code already
carries its `wss://…/room/<id>` URL, so `VITE_CLARA_WS_URL` is only needed when
the browser must use a different relay endpoint than the hub:

```bash
VITE_CLARA_WS_URL=wss://relay.example pnpm clara web start --docker --build
```

The default Web URL is `http://127.0.0.1:8080`. Set **Web URL** in the hub
panel for Pages or a remote deployment; `CLARA_PAIRING_BASE_URL` still overrides
the panel for automation. A `--no-relay` code prints the local web app link even
when the configured Web URL is remote.

Local pairing works from `http://127.0.0.1:8080` or an SSH tunnel. An HTTPS page
cannot open a `ws://` socket, so phones and remote browsers still need the relay.
The container is static and the browser talks to the hub directly; it
does not proxy API or WebSocket traffic. See
[docs/features/install.md](docs/features/install.md) and
[docs/features/connection.md](docs/features/connection.md).

### Orchestrator container

The orchestrator also runs without the hub or web client:

```bash
pnpm clara orchestrator start --docker --build
pnpm clara orchestrator status
pnpm clara orchestrator stop --docker
```

It serves REST, SSE, and MCP on `127.0.0.1:8789` with its bearer token and needs
only a workspace containing `orchestration/index.yml` plus a harness adapter to
execute work orders. The OpenCode adapter and Clara Lab talk to it directly; the
web client is not required. See
[docs/features/orchestration.md](docs/features/orchestration.md).

### Local WebSocket mode

Pair with the local hub directly:

```bash
pnpm clara pair
```

The pairing payload carries the hub's own `ws://127.0.0.1:8788/ws` URL, so no
build-time endpoint is needed. Scan the QR or paste the code on the connect
screen. Local mode still uses E2EE; it does not fall back to plaintext.

Add `--no-relay` (`pnpm clara pair --no-relay`) to force a local-only
code and print the local web app link even when the hub has a relay
configured. The local listener runs
alongside the relay client, so this exercises the WebSocket transport without
sending traffic through Cloudflare. For the dev app,
set **Web URL** to `http://localhost:5173` in the hub panel (or set
`CLARA_PAIRING_BASE_URL=http://localhost:5173` when pairing) so the printed link
opens Vite directly.

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

4. Configure the hub. The systemd unit reads
   `~/.config/clara/server.env` (`KEY=value`, mode `0600`) and restarts with it;
   a hand-started hub service needs the same variables exported:

   ```bash
   CLARA_RELAY_URL=wss://relay.example
   CLARA_RELAY_ROOM=<generated on first run, persisted in server.json>
   CLARA_AGENT_TOKEN=<must match the Worker secret>
   CLARA_CLIENT_TOKEN=<must match the Worker secret>
   ```

   Use your own relay URL. Open the hub panel and set **Web URL** to
   `https://your-clara.example` for a Pages deployment; `CLARA_PAIRING_BASE_URL`
   overrides the panel if you prefer environment configuration.

5. Restart the hub service and check `relay connecting` / `relay online` in its log.
   `pnpm clara pair` must then print a random `Room:` and a `/room/<id>` link;
   a `Room: local` code is local-only and cannot work through the relay.

   The relay URL and room are persisted in `~/.config/clara/server.json`, but the
   two tokens are environment-only and never written there. Missing tokens stop
   the hub service at startup with an error naming the missing variable.

`VITE_CLARA_WS_URL` is the relay deployment switch: it retargets relay-room
pairings and is ignored for `local` pairing codes. When unset, the pairing
payload's URL is used. See
[docs/architecture/relay.md](docs/architecture/relay.md) for the full topology.

## Push notifications

When Clara is connected through the hub, **Settings → Notifications** can
enable Web Push. The hub generates a VAPID key pair on first run and stores
subscriptions at `~/.config/clara/subscriptions.json`.

- On iPhone and iPad, add Clara to the Home Screen from Safari and open it from
  that icon before enabling push.
- Brave on desktop needs **Use Google services for push messaging** enabled at
  `brave://settings/privacy`; Brave has no push service of its own, so
  subscribing fails until that setting is on and the browser is relaunched.
- The hub must be able to reach the browser vendor's push service over HTTPS.
- Revoking a device in the panel clears that device's stored push
  subscriptions. `pnpm clara pair --revoke-all` clears all of them.
- `CLARA_VAPID_SUBJECT` overrides the VAPID contact subject. The default is
  `https://clara.local`; the hub panel can edit the contact stored in
  `vapid.json`.
- Test push from a production build with the hub URL
  (`VITE_CLARA_WS_URL=ws://127.0.0.1:8788 pnpm build && pnpm preview`) or the
  deployed PWA; the Vite dev server does not enable the service worker.

## Client settings sync

The hub can store non-secret browser preferences for paired devices, with
per-namespace revisions, deletes, and size limits over the E2EE session. The
storage and protocol exist; the web client does not sync settings yet and there
is no UI for it. See [docs/features/sync.md](docs/features/sync.md).

## Scripts

| Command                   | Purpose                                                      |
| ------------------------- | ------------------------------------------------------------ |
| `pnpm task session start` | Create a task worktree under `../clara-worktrees`            |
| `pnpm task session list`  | List task worktrees                                          |
| `pnpm task session close` | Check, merge, and remove a task worktree                     |
| `pnpm dev`                | Web dev server and hub service                               |
| `pnpm dev:web`            | Web only                                                     |
| `pnpm dev:panel`          | Hub panel dev server                                         |
| `pnpm dev:server`         | Hub service only                                             |
| `pnpm dev:relay`          | Local `wrangler dev` for the Worker/DO                       |
| `pnpm build`              | Build every workspace package                                |
| `pnpm clara pair`         | Print a pairing code                                         |
| `pnpm clara server panel` | Open the hub panel in a browser                              |
| `pnpm clara start`        | Start the stack (Docker by default; `--local` for processes) |
| `pnpm clara stop`         | Stop the stack                                               |
| `pnpm clara restart`      | Restart the stack                                            |
| `pnpm clara status`       | Probe the orchestrator, hub service, and web client          |
| `pnpm clara logs`         | Follow one service log                                       |
| `pnpm clara server`       | Start, stop, inspect, pair, or reset the hub                 |
| `pnpm clara web`          | Start, stop, inspect, or follow the web client               |
| `pnpm clara orchestrator` | Start, stop, analyze, or inspect the orchestration service   |
| `pnpm clara runner`       | Run script steps for a workspace                             |
| `pnpm clara rebuild`      | Rebuild Clara, recover services, inspect, and verify health  |
| `pnpm test`               | Run crypto, protocol, server, web, and Worker tests          |
| `pnpm check`              | Typecheck + lint + format + Knip + tests                     |
| `pnpm commitlint`         | Lint the last commit message                                 |
| `pnpm deploy:web`         | Build and deploy the Pages project                           |
| `pnpm deploy:relay`       | Deploy the Worker and DO migration                           |
| `pnpm format`             | Prettier write                                               |
| `pnpm format:check`       | Prettier check                                               |

## Security

- Cloudflare sees ciphertext and routing metadata only.
- The browser never receives the OpenCode password in relay mode.
- A pairing link carries a one-time enrollment token, never a long-lived key.
  The browser stores its per-device key as a non-extractable `CryptoKey` in
  IndexedDB. The hub stores device keys encrypted with `secrets.key`.
- Web Push subscriptions live at `~/.config/clara/subscriptions.json`; VAPID
  keys live at `~/.config/clara/vapid.json`. Both use mode `0600`.
- Hub settings, client sync data, and harness connections live in
  `~/.local/share/clara/clara.db` (mode `0600`). Harness passwords are encrypted
  with `secrets.key` (mode `0600`) or `CLARA_SECRET_KEY`; the database alone does
  not expose them. Push endpoints and sync secrets remain in their existing
  files.
- The hub panel requires a superadmin login. It listens on `127.0.0.1:8790`
  by default, guards every request with Host/Origin/fetch-metadata checks, and
  keeps the setup token in `admin-setup.txt` (mode `0600`) until the first login.
  It never returns device keys, harness password, relay tokens, push endpoints,
  sync values, or file contents. It is not exposed through the relay or Pages.
- A lost panel password is reset with `pnpm clara server admin reset` (add
  `--docker` in a container). That command writes a new one-time setup token.
  There is deliberately no network password-reset endpoint.
- Never commit `.env`, `.dev.vars`, `service.json`, push subscriptions, VAPID
  keys, pairing codes, tokens, device keys, `secrets.key`, or `admin-setup.txt`.
- Revoke a lost device with `pnpm clara pair --revoke <deviceId>` or from the
  panel. `pnpm clara pair --revoke-all` revokes every device and clears all
  stored push subscriptions.

See [docs/architecture/e2ee.md](docs/architecture/e2ee.md).

## Stack

Vite 8 · React 19 · TypeScript 6 · Tailwind CSS 4 · shadcn/ui · TanStack Query 5
· React Router 8 · `@opencode/client` 2.1.1 · Node 22 · `ws` · Cloudflare
Workers/Durable Objects.

`@opencode/client` is pinned to the server minor because the API is generated per
release. See [docs/architecture/overview.md](docs/architecture/overview.md).

## Documentation

End-user and self-hosting documentation lives in
[apps/docs/guide/index.md](apps/docs/guide/index.md). Run the site locally with
`pnpm clara docs`; it serves the guide at `/guide/` and the developer docs at
`/internals/`.

Developer and agent documentation starts at [docs/README.md](docs/README.md).
Feature specs follow [docs/features/GUIDE.md](docs/features/GUIDE.md); shipped
scope lives in [docs/features/capabilities.md](docs/features/capabilities.md).

Agent instructions are in [AGENTS.md](AGENTS.md).
