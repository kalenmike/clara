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
apps/server           Node home agent, local WS + outbound relay
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

### Local WebSocket mode

Point the web build at the local agent:

```bash
# apps/web/.env.local
VITE_CLARA_WS_URL=ws://127.0.0.1:8788
```

Then print a pairing code:

```bash
pnpm --filter @clara/server pair
```

Scan the QR or paste the code on the connect screen. Local mode still uses
E2EE; it does not fall back to plaintext.

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

4. Configure the home agent (`~/.config/clara/server.env` or systemd):

   ```bash
   CLARA_RELAY_URL=wss://relay.clara.kalenmichael.com
   CLARA_RELAY_ROOM=<printed by pair>
   CLARA_AGENT_TOKEN=<must match the Worker secret>
   CLARA_CLIENT_TOKEN=<must match the Worker secret>
   ```

5. `node apps/server/dist/index.js pair` prints the QR for a phone or desktop.

`VITE_CLARA_WS_URL` empty keeps direct HTTP mode. See
[docs/architecture/relay.md](docs/architecture/relay.md) for the full topology.

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

| Command             | Purpose                                             |
| ------------------- | --------------------------------------------------- |
| `pnpm dev`          | Web dev server and home agent                       |
| `pnpm dev:web`      | Web only                                            |
| `pnpm dev:server`   | Home agent only                                     |
| `pnpm dev:relay`    | Local `wrangler dev` for the Worker/DO              |
| `pnpm build`        | Build every workspace package                       |
| `pnpm test`         | Run crypto, protocol, server, web, and Worker tests |
| `pnpm check`        | Typecheck + lint + format + Knip + tests            |
| `pnpm deploy:web`   | Build and deploy the Pages project                  |
| `pnpm deploy:relay` | Deploy the Worker and DO migration                  |
| `pnpm format`       | Prettier write                                      |
| `pnpm format:check` | Prettier check                                      |

## Security

- Cloudflare sees ciphertext and routing metadata only.
- The browser never receives the OpenCode password in relay mode.
- The PSK is delivered in a URL fragment, stored in browser storage, and kept
  at `~/.config/clara/server.json` (mode `0600`) on the agent.
- Never commit `.env`, `.dev.vars`, `service.json`, pairing codes, tokens, or the
  PSK.
- Rotate with `node apps/server/dist/index.js pair --rotate`.

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
