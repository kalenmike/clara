# Clara

A secure web client for [OpenCode](https://opencode.ai) sessions: projects,
sessions, streaming chat, agents, models, slash commands, `@` mentions, and live
usage. Clara can reach a home OpenCode server through an end-to-end encrypted
Cloudflare relay, or connect directly on a trusted network.

## Requirements

- Node 22 (see `.nvmrc`)
- pnpm 11
- A running OpenCode 2.1.x server
- Optional: a Cloudflare account and the `clara.kalenmichael.com` zone for
  remote access

## Workspace

```text
apps/web              React/Vite SPA, deployed to Cloudflare Pages
apps/panel            Loopback dashboard and admin controls served by the home agent
apps/server           Node home agent, local WS + outbound relay
plugins/clara         OpenCode ledger plugin and Clara agent definitions
packages/shared-types Wire frames, actions, states, pairing payloads
packages/crypto       PSK derivation, AES-GCM envelopes, replay guard
workers/relay         Cloudflare Worker + RelayRoom Durable Object
```

## Quick start

```bash
pnpm install
opencode service start      # or: opencode serve --cors http://localhost:5173
pnpm dev                    # web on :5173 and the home agent on :8788
```

Open <http://localhost:5173>. The connect screen accepts a pairing code or a
direct OpenCode URL/password. The home agent reads the OpenCode password from:

```text
${XDG_STATE_HOME:-~/.local/state}/opencode/service.json
```

### Agent panel

The home agent serves a loopback dashboard and control surface on its own
listener. In development, run the API and the panel separately:

```bash
pnpm dev:server
pnpm dev:panel   # http://localhost:5174
```

In a production build, the panel ships inside the agent and is available at
<http://127.0.0.1:8790> after `pnpm build` and `pnpm clara:serve`. Run
`pnpm clara:control` to open it: the command starts the built agent when it is
not already serving the panel, opens the URL in a browser, and stays attached
so the agent logs remain visible. It is loopback-only and never routed through
the relay. From it you can disable the
OpenCode connection, local transport, relay, or push, and stop every external
connection while the process, panel, and database stay alive. Settings are
stored at `CLARA_DB_PATH` or `~/.config/clara/clara.db` (mode `0600`). The panel
shows no PSK, OpenCode password, relay tokens, push endpoints, sync values, or
file contents. See [docs/features/panel.md](docs/features/panel.md) and
[docs/features/agent-controls.md](docs/features/agent-controls.md).

### Local WebSocket mode

Pair with the local agent directly:

```bash
pnpm --filter @clara/server pair
```

The pairing payload carries the agent's own `ws://127.0.0.1:8788/ws` URL, so no
build-time endpoint is needed. Scan the QR or paste the code on the connect
screen. Local mode still uses E2EE; it does not fall back to plaintext.

Add `--local` (`pnpm --filter @clara/server pair:local`) to force a local-only
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
   VITE_CLARA_WS_URL=wss://relay.clara.kalenmichael.com pnpm --filter @clara/web build
   ```

3. Deploy `apps/web/dist` to the Pages project `clara` and attach
   `clara.kalenmichael.com`.

4. Configure the home agent. The systemd unit reads
   `~/.config/clara/server.env` (`KEY=value`, mode `0600`) and restarts with it;
   a hand-started agent needs the same variables exported:

   ```bash
   CLARA_RELAY_URL=wss://relay.clara.kalenmichael.com
   CLARA_RELAY_ROOM=<generated on first run, persisted in server.json>
   CLARA_AGENT_TOKEN=<must match the Worker secret>
   CLARA_CLIENT_TOKEN=<must match the Worker secret>
   ```

5. Restart the agent and check `relay connecting` / `relay online` in its log.
   `clara-server pair` must then print a random `Room:` and a `/room/<id>` link;
   a `Room: local` code is local-only and cannot work through the relay.

   The relay URL and room are persisted in `~/.config/clara/server.json`, but the
   two tokens are environment-only and never written there. Missing tokens stop
   the agent at startup with an error naming the missing variable.

`VITE_CLARA_WS_URL` is the relay deployment switch: it retargets relay-room
pairings and is ignored for `local` pairing codes. When unset, the pairing
payload's URL is used for both. An empty variable does not select direct mode —
that comes from the connect screen or the `/oc` dev proxy. See
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
- `node apps/server/dist/index.js pair --rotate` clears all stored push
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

## Direct mode

Start OpenCode with Clara's origin allowed:

```bash
opencode serve --cors http://localhost:5173
```

Open **Connect**, enter the URL (for example `http://127.0.0.1:4096`) and the
password printed by `opencode serve` as `server password …`. Optionally check
"Remember this connection".

`pnpm dev` and `pnpm preview` include the `/oc` proxy, which discovers a service
started with `opencode service start`. Production builds use manual credentials
or the relay.

## Scripts

| Command              | Purpose                                             |
| -------------------- | --------------------------------------------------- |
| `pnpm dev`           | Web dev server and home agent                       |
| `pnpm dev:web`       | Web only                                            |
| `pnpm dev:panel`     | Agent panel dev server                              |
| `pnpm dev:server`    | Home agent only                                     |
| `pnpm dev:relay`     | Local `wrangler dev` for the Worker/DO              |
| `pnpm build`         | Build every workspace package                       |
| `pnpm clara:control` | Serve the built panel and open it in a browser      |
| `pnpm test`          | Run crypto, protocol, server, web, and Worker tests |
| `pnpm check`         | Typecheck + lint + format + Knip + tests            |
| `pnpm commitlint`    | Lint the last commit message                        |
| `pnpm deploy:web`    | Build and deploy the Pages project                  |
| `pnpm deploy:relay`  | Deploy the Worker and DO migration                  |
| `pnpm format`        | Prettier write                                      |
| `pnpm format:check`  | Prettier check                                      |

## Security

- Cloudflare sees ciphertext and routing metadata only.
- The browser never receives the OpenCode password in relay mode.
- The PSK is delivered in a URL fragment, stored in browser storage, and kept
  at `~/.config/clara/server.json` (mode `0600`) on the agent.
- Web Push subscriptions live at `~/.config/clara/subscriptions.json`; VAPID
  keys live at `~/.config/clara/vapid.json`. Both use mode `0600`.
- Agent settings and non-secret client sync data live in
  `~/.config/clara/clara.db` (mode `0600`). Credentials, push endpoints, and
  sync secrets are never written there.
- The agent panel listens only on `127.0.0.1:8790`, guards reads with
  Host/Origin/fetch-metadata checks, and accepts only two JSON control routes
  with a custom header and an 8 KB body limit. It never returns the PSK,
  OpenCode password, relay tokens, push endpoints, sync values, or file
  contents. It is not exposed through the relay or Pages.
- Never commit `.env`, `.dev.vars`, `service.json`, push subscriptions, VAPID
  keys, pairing codes, tokens, or the PSK.
- Rotate with `node apps/server/dist/index.js pair --rotate`; this also clears
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
