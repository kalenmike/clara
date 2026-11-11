# Architecture overview

Clara is a browser/PWA client for one running OpenCode server, plus a hub: a small
service on your machine that carries the OpenCode HTTP/SSE API over an
end-to-end encrypted WebSocket. The web app reads projects, sessions, and
messages; the hub owns OpenCode authentication, the outbound relay connection,
and Web Push delivery while Clara is closed.

## Vocabulary

The home-side installation is the **hub**. Three names cover it:

| Name        | Meaning                                                                                                                        |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Hub         | The Clara installation on the machine that runs the harness: one process, one database, one panel, and at most one relay room. |
| Hub service | The Node process that implements the hub (`apps/server`, `pnpm clara server`, the `clara-server` container).                   |
| Hub panel   | The authenticated loopback dashboard served by the hub service (`apps/panel`).                                                 |

Other terms:

- **Harness** — the agent runtime the hub proxies. OpenCode is the only one today.
- **Agent** — an LLM worker, prompt, or agent definition in a harness or
  orchestration package. It never means the hub.
- **Client** / **device** — the browser or installed PWA.
- **Relay** — the Cloudflare Worker and Durable Object that forward encrypted
  frames.

Wire and configuration names keep the historical `agent` role: the relay
authenticates the hub as `clara.role.agent` with `CLARA_AGENT_TOKEN`, frames use
`agent.status` and `ready.agent`, and shared types expose `AgentInfo`. Those are
compatibility names, not prose.

## Stack

| Layer        | Choice                                                                |
| ------------ | --------------------------------------------------------------------- |
| Workspace    | pnpm 11 workspaces                                                    |
| Build        | Vite 8, TypeScript 6                                                  |
| Web          | React 19, React Router 8, Tailwind CSS 4, shadcn/ui (radix-nova)      |
| Server state | TanStack Query 5                                                      |
| Stream state | A small external store (`chatStore`) read with `useSyncExternalStore` |
| OpenCode     | `@opencode/client` **2.1.1**, pinned to the server minor              |
| Hub service  | Node 22, `ws`, `node:http`, WebCrypto                                 |
| Relay        | Cloudflare Worker + `RelayRoom` Durable Object                        |
| Crypto       | Device key → HKDF-SHA-256 → AES-256-GCM (WebCrypto)                   |

### Version contract

The API is generated per OpenCode release. Clara pins `@opencode/client` to the
same version as the server it targets (2.1.1). Before bumping either side:

1. Check the server's `/openapi.json` for endpoint or payload changes.
2. Update the client package to the same version.
3. Run `pnpm check` and re-test connect, stream, send, and switch flows through
   both the local WebSocket and relay transports.

`@opencode-ai/sdk` is not used: that package targets the v1 API and does not
match the v2 server. `@opencode/sdk` bundles an embedded Node server and is not
browser-safe, so Clara uses the browser client from the same family.

## Workspace

```text
apps/
  web/                 React SPA, deployed to Cloudflare Pages or the web container
  panel/               Loopback dashboard and admin controls served by the hub service
  server/              Node hub service, outbound relay client, local WS listener, /v1 API
  orchestrator/        Loopback orchestration service and CLI
  mcp/                 stdio MCP bridge to the orchestration service
  api-mcp/             stdio read-only MCP bridge to the hub API
packages/
  shared-types/        Wire frames, actions, states, pairing payloads
  api-contract/        Hub API schemas and generated OpenAPI components
  api-client/          Fetch-based hub API SDK
  api-mcp/             Read-only hub API MCP tools
  orchestration/       Package loader, runtime, leases, and watchdog
  orchestration-control/ Shared service paths, health, start, and stop helpers
  crypto/              device-key derivation, AES-GCM envelopes, replay guard
workers/
  relay/               Worker + RelayRoom Durable Object
docs/
```

## Topology

```text
OpenCode HTTP/SSE
      ▲
      │ basic auth, server-side only
      ▼
Clara hub ──outbound WSS──▶ Worker ──▶ RelayRoom DO ◀──WSS── web / iPhone PWA
      │                                              │
      └──────────── E2EE payloads ───────────────────┘
      │
      ├── /v1 API ──▶ active harness (OpenCode now)
      └── Web Push (VAPID) ──▶ Apple / browser push service ──▶ service worker

Local mode: web ──WSS──▶ hub /v1 API ──▶ active harness (OpenCode now)
Local tools: MCP ──HTTP 127.0.0.1:8788──▶ hub /v1 API
Panel: browser ──HTTP 127.0.0.1:8790──▶ hub (auth + setup + controls)
Harness: panel ──▶ SQLite harness_connections (encrypted secret) ──▶ harness client
Docker: web client, hub, orchestrator, and OpenCode on the `clara` bridge network
```

The relay forwards opaque frames. It does not parse, store, or replay payloads.
Push subscriptions travel through the E2EE channel, but delivery uses the Web
Push protocol directly from the hub to the browser vendor's push service.

The hub owns a versioned `/v1` API. The browser reaches it over the same E2EE
WebSocket; local tools and the read-only MCP reach it over a bearer-token
loopback listener. OpenAPI is at `/openapi.json` and Swagger UI at `/docs`. See
[api.md](api.md), [relay.md](relay.md), [e2ee.md](e2ee.md), and
[notifications.md](../features/notifications.md).

## Connecting

Clara supports two transports, both through the hub:

| Mode  | Selected by                        | Auth                            |
| ----- | ---------------------------------- | ------------------------------- |
| Relay | `VITE_CLARA_WS_URL` + pairing code | Device key + relay client token |
| Local | Pairing payload URL (`local` room) | Device key + local WebSocket    |

The connect screen first proves any pairing link or stored device behind a
branded splash. If none connects, it shows the pairing form. There is no direct
HTTP option: every browser connection goes through the hub. Pairing is
described in [pairing.md](../features/pairing.md).

The OpenCode password never reaches the browser. The hub adds basic auth,
strips client-supplied authorization/hop-by-hop headers, and only reaches
`/api/` paths on the configured origin from server-side API handlers. The web
client uses `@clara/api-client` against `/v1`; the browser has no generic
OpenCode proxy.

## Runtime shape

```text
ConnectionProvider
  └─ creates the Clara SDK client
       └─ createClaraClient({ fetch: relayFetchOverWebSocket })
            ├─ TanStack Query: projects, sessions, messages, catalog, approvals
            └─ EventProvider: one SSE subscription for the whole tab
                 ├─ chatStore: applies streaming deltas per session
                 └─ query invalidations: durable events and list changes
```

- The relay transport is a `fetch`-compatible shim over one WebSocket. It maps
  HTTP requests to encrypted action frames, streams responses back through a
  `ReadableStream`, and supports abort, binary bodies, and SSE.
- **`chatStore`** keeps a snapshot per session (messages, status, cost, tokens)
  and batches notifications with `requestAnimationFrame`.
- **TanStack Query** owns everything requested on demand. Event handlers
  invalidate keys instead of duplicating server state.
- **EventProvider** reconnects with jittered exponential backoff, treats 45s
  without a heartbeat as a dead stream, and invalidates cached queries after a
  reconnect. It tolerates unknown event types.
- The hub keeps one E2EE session per browser connection. Relay clients
  are independent; the Durable Object broadcasts hub frames and clients drop
  frames for other sessions.
- The hub service also reads OpenCode's `/api/event` stream for push and stores
  Web Push subscriptions at `~/.config/clara/subscriptions.json`. VAPID keys
  live in `~/.config/clara/vapid.json`.
- The hub service serves `apps/panel` on a second listener (default
  `127.0.0.1:8790`). It requires a superadmin session, provides first-run setup
  and harness configuration, reads one allowlisted runtime snapshot, exposes
  guarded controls for the four external features, the Go offline control,
  monitoring, the client-sync gate and cadence, and the local orchestration
  service, and never returns device keys, harness password, tokens,
  push endpoints, sync values, or file contents. See
  [panel.md](../features/panel.md) and
  [hub-controls.md](../features/hub-controls.md).
- Harness connections live in SQLite; exactly one is active. `HarnessManager`
  builds the matching client on load and after a panel save, so the hub proxy
  hot-swaps without a restart. OpenCode is the first adapter.
- Feature choices, the stopped flag, monitoring, the orchestration switch, the
  client-sync gate and interval, panel users, and harness connections live in a
  `better-sqlite3` database at
  `CLARA_DB_PATH` or `<data dir>/clara.db`. Desired state is persisted first;
  effective state also requires the transport to start. The same database holds
  the non-secret client sync namespace, described in
  [sync.md](../features/sync.md).
- The web `SettingsSyncProvider` pulls enabled categories on connect, pushes
  debounced local edits, and checks a lightweight namespace revision on the
  server-selected cadence. A revision match skips the full pull.

## Routing

| Route                        | Screen                                                     |
| ---------------------------- | ---------------------------------------------------------- |
| `/connect`                   | Pairing and stored-device connection                       |
| `/`                          | Start view; creates a session and opens its draft composer |
| `/p/:projectId`              | Project details and session grid                           |
| `/p/:projectId/s/:sessionId` | Chat                                                       |
| `/settings`                  | Appearance, preferences, notifications, sync, shortcuts    |

The start view is reused inside `/p/:projectId/s/:sessionId` when the session has
no messages. Its action opens the reply window in the last-used size (expanded by
default) instead of creating another session.

## Project and directory scoping

Sessions belong to a project, and one project can own sessions in several
locations: its canonical directory, git worktrees, and sandboxes. Clara lists
sessions with `GET /api/session?project=<id>` so sessions moved to a worktree
stay in the project view. The `directory` filter is exact and is not used for
the session list.

The canonical directory is still used to create sessions and to scope
location-specific data such as skills, references, and pending approvals. For an
open session, its `location.directory` wins when it differs from the project
canonical.

The server can keep more than one project record for the same canonical path,
for example before and after `git init`. Clara prefers the VCS-backed record, so
route and remembered IDs resolve to the project that owns the sessions.

Sessions can report `projectID: "global"`. Session rows build links from the
route/selected project ID; notifications resolve the owning project, preferring
the session's project ID and falling back to the canonical directory.

Session-scoped endpoints (`messages`, `prompt`, `command`, `switchAgent`,
`switchModel`, `context`) take only the session ID; the server resolves the
directory from the session record. Moving a session to a worktree changes only
`location.directory`; its project ID stays the same.

## Host command policy

The browser has no generic shell path. Git history is the only host command
Clara runs: the hub's `/v1/git/log` endpoint builds a fixed `git log -n 10` with
a machine-readable `--format` from validated timestamps and the session
directory, runs it through OpenCode's shell API, and returns parsed commits. See
[git.md](../features/git.md).

## Streaming model

The event stream is the source of truth while a run is active:

- `session.step.started` creates the assistant message.
- `session.text.*` and `session.reasoning.*` append to content parts by ordinal.
- `session.tool.*` maintains tool cards and their input/output.
- `session.usage.updated` and `session.step.ended` update cost and tokens.
- `session.status`, `session.execution.*`, and `session.idle` drive the run badge
  and the active-session map.
- Durable events trigger a debounced message refetch.
- `session.step.failed` and `session.execution.failed` attach the provider error
  to the assistant turn.

A refetch on idle reconciles the stream with persisted history. On the WebSocket
transport a dropped socket errors the SSE response, and the existing EventProvider
loop re-subscribes through the transport.

## Security notes

- The hub only exposes the typed `/v1` API. The browser has no generic OpenCode
  proxy or shell path; the one host command is the fixed Git history endpoint.
- Never commit `service.json`, passwords, pairing codes, device keys, relay tokens,
  `secrets.key`, or `admin-setup.txt`.
- The hub's config is `~/.config/clara/server.json` (mode `0600`).
  Settings, client sync data, panel users, and harness connections live in
  `~/.local/share/clara/clara.db` (mode `0600`). Harness passwords are encrypted
  with `secrets.key` (mode `0600`) or `CLARA_SECRET_KEY`, so the database alone
  does not expose them. `vapid.json`, `subscriptions.json`, and the temporary
  `admin-setup.txt` remain in `~/.config/clara` with the same mode. These are
  the local install paths. The Docker stack uses the `clara-server-config` and
  `clara-server-data` volumes instead and keeps its host control token under
  `~/.local/share/clara/docker`.
- The relay sees metadata only; all payloads are E2EE. Web Push payloads use
  Web Push encryption to the browser subscription, not Clara's device envelope.
- The web stores a non-extractable device key in IndexedDB; no raw connection
  key is written to `localStorage`. `_headers` ships a CSP, but XSS on the Pages
  origin can still use the key while the page is open.
- Relay tokens are defense in depth; the per-device key is the real
  authentication key.
- The Worker uses separate hub/client tokens so a paired client cannot
  impersonate the hub.
- The hub panel requires a superadmin login and defaults to `127.0.0.1`. It
  checks the socket address when remote access is not explicitly allowed, plus
  `Host`, `Origin`, and fetch metadata, and never returns device keys, harness
  password, tokens, push endpoints, sync values, or file contents. The first-run
  setup token is written to a host-only file; a lost password is reset by a
  host-only command, never over HTTP. Authentication is not host isolation;
  keep the database and `secrets.key` private.

## Related

- [Relay](relay.md)
- [E2EE](e2ee.md)
- [Pairing](../features/pairing.md)
- [Feature guide](../features/GUIDE.md)
- [Capabilities](../features/capabilities.md)
- [Connection](../features/connection.md)
