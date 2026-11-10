# Architecture overview

Clara is a browser/PWA client for one running OpenCode server, plus a small home
agent that can carry the OpenCode HTTP/SSE API over an end-to-end encrypted
WebSocket. The web app reads projects, sessions, and messages; the agent owns
OpenCode authentication, the outbound relay connection, and Web Push delivery
while Clara is closed.

## Stack

| Layer        | Choice                                                                |
| ------------ | --------------------------------------------------------------------- |
| Workspace    | pnpm 11 workspaces                                                    |
| Build        | Vite 8, TypeScript 6                                                  |
| Web          | React 19, React Router 8, Tailwind CSS 4, shadcn/ui (radix-nova)      |
| Server state | TanStack Query 5                                                      |
| Stream state | A small external store (`chatStore`) read with `useSyncExternalStore` |
| OpenCode     | `@opencode/client` **2.1.1**, pinned to the server minor              |
| Home agent   | Node 22, `ws`, `node:http`, WebCrypto                                 |
| Relay        | Cloudflare Worker + `RelayRoom` Durable Object                        |
| Crypto       | PSK → HKDF-SHA-256 → AES-256-GCM (WebCrypto)                          |

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
  web/                 React SPA, deployed to Cloudflare Pages
  panel/               Loopback dashboard and admin controls served by the home agent
  server/              Node home agent, outbound relay client, local WS listener
  orchestrator/        Loopback orchestration service and CLI
  mcp/                 stdio MCP bridge
packages/
  shared-types/        Wire frames, actions, states, pairing payloads
  orchestration/       Package loader, runtime, leases, and watchdog
  orchestration-control/ Shared service paths, health, start, and stop helpers
  crypto/              PSK derivation, AES-GCM envelopes, replay guard
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
Clara home agent ──outbound WSS──▶ Worker ──▶ RelayRoom DO ◀──WSS── web / iPhone PWA
      │                                              │
      └──────────── E2EE payloads ───────────────────┘
      │
      └── Web Push (VAPID) ──▶ Apple / browser push service ──▶ service worker

Local mode: web ──WSS──▶ home agent ──▶ active harness (OpenCode now)
Panel: browser ──HTTP 127.0.0.1:8790──▶ home agent (auth + setup + controls)
Harness: panel ──▶ SQLite harness_connections (encrypted secret) ──▶ harness client
Docker: home agent, orchestrator, and OpenCode on the `clara` bridge network
```

The relay forwards opaque frames. It does not parse, store, or replay payloads.
Push subscriptions travel through the E2EE channel, but delivery uses the Web
Push protocol directly from the home agent to the browser vendor's push service.
See [relay.md](relay.md), [e2ee.md](e2ee.md), and
[notifications.md](../features/notifications.md).

## Connecting

Clara supports two transports, both through the home agent:

| Mode        | Selected by                        | Auth                          |
| ----------- | ---------------------------------- | ----------------------------- |
| Relay       | `VITE_CLARA_WS_URL` + pairing code | E2EE PSK + relay client token |
| Local agent | Pairing payload URL (`local` room) | E2EE PSK + local WebSocket    |

The connect screen first proves any pairing link or stored device behind a
branded splash. If none connects, it shows the pairing form. There is no direct
HTTP option: every browser connection goes through the home agent. Pairing is
described in [pairing.md](../features/pairing.md).

The OpenCode password never reaches the browser. The home agent adds basic auth,
strips client-supplied authorization/hop-by-hop headers, and only proxies
`/api/` paths on the configured origin.

## Runtime shape

```text
ConnectionProvider
  └─ creates the SDK client
       └─ OpenCode.make({ fetch: relayFetchOverWebSocket })
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
- The home agent keeps one E2EE session per browser connection. Relay clients
  are independent; the Durable Object broadcasts agent frames and clients drop
  frames for other sessions.
- The home agent also reads OpenCode's `/api/event` stream for push and stores
  Web Push subscriptions at `~/.config/clara/subscriptions.json`. VAPID keys
  live in `~/.config/clara/vapid.json`.
- The home agent serves `apps/panel` on a second listener (default
  `127.0.0.1:8790`). It requires a superadmin session, provides first-run setup
  and harness configuration, reads one allowlisted runtime snapshot, exposes
  guarded controls for the four external features, the master stop, the shell
  policy, monitoring, the client-sync gate and cadence, and the local
  orchestration service, and never returns the PSK, harness password, tokens,
  push endpoints, sync values, or file contents. See
  [panel.md](../features/panel.md) and
  [agent-controls.md](../features/agent-controls.md).
- Harness connections live in SQLite; exactly one is active. `HarnessManager`
  builds the matching client on load and after a panel save, so the agent proxy
  hot-swaps without a restart. OpenCode is the first adapter.
- Feature choices, the stopped flag, shell policy, monitoring, the
  orchestration switch, the client-sync gate and interval, panel users, and
  harness connections live in a `better-sqlite3` database at
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

The web client normally only reads OpenCode state. The one exception is Git
history: the Git tab asks the home agent to run `git log -n 10` with a
machine-readable `--format` through OpenCode's shell API.

The agent inspects every proxied request before forwarding it. Command-capable
routes — `/api/shell`, `/api/session/:id/shell`, `/api/pty`,
`/api/experimental/persistent-pty`, and
`/api/experimental/session/:id/terminal` — are refused with `403` unless the
saved shell policy allows the request:

- `off` blocks every command request and every `/api/shell` read.
- `allowlist` admits a request only when a saved entry is a literal argv prefix.
  Shell syntax is refused rather than parsed, and interpreters such as `sh`,
  `env`, or `python` cannot be saved. The working directory must stay inside the
  request's location.

The policy lives in `clara.db`, is read on every request, and is changed from the
loopback panel. It applies only to command requests; other OpenCode APIs are
outside it. It is a guardrail, not a sandbox: see
[git.md](features/git.md#not-a-sandbox).

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

- The shell policy is a guardrail, not a sandbox. It filters command requests
  relayed by the agent, but a modified web build can still use non-command
  OpenCode APIs through the agent.
- Never commit `service.json`, passwords, pairing codes, PSKs, relay tokens,
  `secrets.key`, or `admin-setup.txt`.
- The home agent's config is `~/.config/clara/server.json` (mode `0600`).
  Settings, client sync data, panel users, and harness connections live in
  `~/.local/share/clara/clara.db` (mode `0600`). Harness passwords are encrypted
  with `secrets.key` (mode `0600`) or `CLARA_SECRET_KEY`, so the database alone
  does not expose them. `vapid.json`, `subscriptions.json`, and the temporary
  `admin-setup.txt` remain in `~/.config/clara` with the same mode.
- The relay sees metadata only; all payloads are E2EE. Web Push payloads use
  Web Push encryption to the browser subscription, not Clara's PSK envelope.
- The web stores the PSK in `localStorage`; `_headers` ships a CSP but XSS on the
  Pages origin can still reach browser storage.
- Relay tokens are defense in depth; the PSK is the real authentication key.
- The Worker uses separate agent/client tokens so a paired client cannot
  impersonate the home agent.
- The agent panel requires a superadmin login and defaults to `127.0.0.1`. It
  checks the socket address when remote access is not explicitly allowed, plus
  `Host`, `Origin`, and fetch metadata, and never returns the PSK, harness
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
