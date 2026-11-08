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
   both direct and relay transports.

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

Local mode: web ──WSS──▶ home agent ──▶ OpenCode
Direct mode: web ──HTTP/SSE──▶ OpenCode (legacy / operator-managed)
Panel: browser ──HTTP 127.0.0.1:8790──▶ home agent (status + controls)
```

The relay forwards opaque frames. It does not parse, store, or replay payloads.
Push subscriptions travel through the E2EE channel, but delivery uses the Web
Push protocol directly from the home agent to the browser vendor's push service.
See [relay.md](relay.md), [e2ee.md](e2ee.md), and
[notifications.md](../features/notifications.md).

## Connecting

Clara supports three modes:

| Mode        | Selected by                        | Auth                                                  |
| ----------- | ---------------------------------- | ----------------------------------------------------- |
| Relay       | `VITE_CLARA_WS_URL` + pairing code | E2EE PSK + relay client token                         |
| Local agent | Pairing payload URL (`local` room) | E2EE PSK + local WebSocket                            |
| Direct      | No pairing                         | OpenCode HTTP basic auth, or the Vite `/oc` dev proxy |

The connect screen first proves any pairing link or stored device behind a
branded splash. If none connects, it offers a chooser with the pairing form and
the direct URL/password fallback; only the chosen form renders. Pairing is
described in [pairing.md](../features/pairing.md).

Direct mode reads the background service registration when present:

```text
${XDG_STATE_HOME:-~/.local/state}/opencode/service.json
```

The Vite dev server proxies `/oc` to that service with the `authorization`
header attached, so the browser never sees the password. `opencode serve` does
not write `service.json`; connect to it manually with its URL and the password
printed at startup, and allow Clara's origin with `--cors`.

In relay/local mode the OpenCode password never reaches the browser. The home
agent adds basic auth, strips client-supplied authorization/hop-by-hop headers,
and only proxies `/api/` paths on the configured origin.

## Runtime shape

```text
ConnectionProvider
  └─ creates the SDK client
       ├─ direct: OpenCode.make({ baseUrl, headers })
       └─ relay/local: OpenCode.make({ fetch: relayFetchOverWebSocket })
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
- The home agent serves `apps/panel` on a second loopback listener (default
  `127.0.0.1:8790`). It reads one allowlisted runtime snapshot, exposes guarded
  controls for the four external features, the master stop, the shell policy,
  monitoring, the client-sync gate and cadence, and the local orchestration
  service, and never exposes the PSK, secrets, sync values, or file contents. See
  [panel.md](../features/panel.md) and
  [agent-controls.md](../features/agent-controls.md).
- Feature choices, the stopped flag, shell policy, monitoring, the
  orchestration switch, and the client-sync gate and interval live in a
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
| `/connect`                   | Pairing, direct server form, local service detection       |
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
loopback panel. It applies only to requests that travel through the agent.
Direct connections and non-command APIs are outside it. It is a guardrail, not a
sandbox: see [git.md](features/git.md#not-a-sandbox).

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

A refetch on idle reconciles the stream with persisted history. In relay mode a
dropped WebSocket errors the SSE response, and the existing EventProvider loop
re-subscribes through the transport.

## Security notes

- The shell policy is a guardrail, not a sandbox. It filters command requests
  relayed by the agent, but a modified web build can still use non-command
  OpenCode APIs, and direct mode has no Clara-enforced policy at all.
- Never commit `service.json`, passwords, pairing codes, PSKs, or relay tokens.
- The home agent's config is `~/.config/clara/server.json` (mode `0600`).
  Settings and non-secret client sync data live in
  `~/.local/share/clara/clara.db` (mode `0600`). `vapid.json` and
  `subscriptions.json` remain in `~/.config/clara` with the same mode.
- The relay sees metadata only; all payloads are E2EE. Web Push payloads use
  Web Push encryption to the browser subscription, not Clara's PSK envelope.
- The web stores the PSK in `localStorage`; `_headers` ships a CSP but XSS on the
  Pages origin can still reach browser storage.
- Relay tokens are defense in depth; the PSK is the real authentication key.
- The Worker uses separate agent/client tokens so a paired client cannot
  impersonate the home agent.
- The agent panel is loopback-only and independent of `CLARA_LOCAL_HOST`. It
  checks the socket address, `Host`, `Origin`, and fetch metadata, allows
  `GET`/`HEAD` reads plus two guarded `POST` control routes, and never returns
  the PSK, password, tokens, push endpoints, sync values, or file contents.
  Loopback is not user isolation; the panel assumes a single-user machine.

## Related

- [Relay](relay.md)
- [E2EE](e2ee.md)
- [Pairing](../features/pairing.md)
- [Feature guide](../features/GUIDE.md)
- [Capabilities](../features/capabilities.md)
- [Connection](../features/connection.md)
