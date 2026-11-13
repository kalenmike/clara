# Architecture overview

Clara is a browser/PWA client for agent harnesses, plus a hub: a small service on
your machine that carries harness traffic over an end-to-end encrypted WebSocket.
The web app reads projects, sessions, and messages; the hub owns transport,
adapter routing, the outbound relay connection, and Web Push delivery while Clara
is closed. A harness is reached through an **adapter** on the harness machine.
This repository includes the OpenCode and Claude Code adapters; the hub and
web client do not depend on either harness.

## Vocabulary

The home-side installation is the **hub**. Three names cover it:

| Name        | Meaning                                                                                                                            |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Hub         | The Clara installation on the machine that runs the hub service: one process, one database, one panel, and at most one relay room. |
| Hub service | The Node process that implements the hub (`apps/hub/server`, `pnpm clara server`, the `clara-server` container).                   |
| Hub panel   | The authenticated loopback dashboard served by the hub service (`apps/hub/panel`).                                                 |

Other terms:

- **Harness** — the agent runtime Clara connects to. OpenCode is the harness used
  by the included adapter.
- **Adapter** — the process on the harness machine that speaks the Clara Harness
  Protocol, translates harness requests and events, and connects out to the hub.
  It owns harness authentication.
- **Adapter host** — the machine that runs a harness and its adapter. It may be
  the hub host or a separate machine; the adapter connects out in both cases.
- **Agent** — an LLM worker, prompt, or agent definition in a harness or
  orchestration package. It never means the hub.
- **Client** / **device** — the browser or installed PWA.
- **Relay** — the Cloudflare Worker and Durable Object that forward encrypted
  frames from browsers and adapters.

Wire and configuration names keep the historical `agent` role: the relay
authenticates the hub as `clara.role.agent` with `CLARA_AGENT_TOKEN`, frames use
`agent.status` and `ready.agent`, and shared types expose `AgentInfo`. Those are
compatibility names, not prose.

## Stack

| Layer        | Choice                                                                                                                              |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| Workspace    | pnpm 11 workspaces                                                                                                                  |
| Build        | Vite 8, TypeScript 6                                                                                                                |
| Web          | React 19, React Router 8, Tailwind CSS 4, shadcn/ui (radix-nova)                                                                    |
| Server state | TanStack Query 5                                                                                                                    |
| Stream state | A small external store (`chatStore`) read with `useSyncExternalStore`                                                               |
| Adapter SDK  | `@opencode/client` **2.1.1** (OpenCode) and `@anthropic-ai/claude-agent-sdk` **0.3.325** (Claude Code), each inside its own adapter |
| Hub service  | Node 22, `ws`, `node:http`, WebCrypto                                                                                               |
| Relay        | Cloudflare Worker + `RelayRoom` Durable Object                                                                                      |
| Crypto       | Device key → HKDF-SHA-256 → AES-256-GCM (WebCrypto)                                                                                 |

### Version contract

Clara pins `@opencode/client` to the OpenCode server version it targets (2.1.1)
inside `apps/adapters/opencode` and `tools/lab`, and pins
`@anthropic-ai/claude-agent-sdk` (0.3.325, bundling Claude Code 2.1.325)
inside `apps/adapters/claude`. The hub has no harness SDK. The
`/v1` DTOs and OpenAPI components are Clara-owned in `@clara/api-contract`; the
web and SDK never import the harness client. Before bumping either side:

1. Check the server's `/openapi.json` for endpoint or payload changes.
2. Update the harness client in `apps/adapters/opencode` and `tools/lab` to the
   same version.
3. Update the Clara schemas and the adapter's mapping when the upstream
   payloads changed.
4. Run `pnpm check` and re-test connect, stream, send, and switch flows through
   both the local WebSocket and relay transports.

`@opencode-ai/sdk` is not used: that package targets the v1 API and does not
match the v2 server. `@opencode/sdk` bundles an embedded Node server and is not
browser-safe, so Clara uses the browser client from the same family.

## Workspace

```text
apps/
  web/                 React SPA, deployed to Cloudflare Pages or the web container
  hub/
    server/            Node hub service, outbound relay client, local WS listener, /v1 API
    panel/             Loopback dashboard and admin controls served by the hub service
  orchestrator/        Loopback orchestration service and CLI
  adapters/
    opencode/          OpenCode harness adapter, binding, and standalone bin
    claude/            Claude Code harness adapter and standalone bin
tools/
  cli/                 Developer CLI for the stack, worktrees, and docs
  lab/                 Loopback pipeline preview and agent probe
  docs/                User guide and internal documentation site
packages/
  contracts/           shared-types, api-contract, harness-protocol
  api/                 api-client, mcp
  orchestration/       engine, policy, control, mcp
  adapters/            runtime, binding, runner
  preview/             Pipeline preview, diagnostics, and snapshot diff SDK
  crypto/              device-key derivation, AES-GCM envelopes, replay guard
infra/
  relay/               Cloudflare Worker + RelayRoom Durable Object
  docker/              Compose files, Dockerfiles, and the stack .env example
docs/                  Internal documentation
```

## Topology

```text
Harness HTTP/SSE
      ▲
      │ local network, adapter only
      ▼
adapter ──outbound WSS──▶ hub ◀──outbound WSS── web / iPhone PWA
      │                    │
      └── Clara Harness Protocol over E2EE ──┘
                           │
                           ├── /v1 API ──▶ active adapter
                           └── Web Push (VAPID) ──▶ push service

Local mode: web ──WSS──▶ hub /v1 API ──▶ active adapter ──▶ harness
Local tools: MCP ──HTTP 127.0.0.1:8788──▶ hub /v1 API
Panel: browser ──HTTP 127.0.0.1:8790──▶ hub (auth + setup + controls)
Harness: panel ──▶ SQLite harness identity/pairing ──▶ adapter session (E2EE)
Docker: web client, hub, orchestrator, and an optional harness on the `clara` bridge network
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

The harness password never reaches the browser. The adapter adds harness
authentication and is the only process that talks to the harness. The browser
uses `@clara/api-client` against `/v1`; the hub maps those calls to the active
adapter and never exposes a generic harness proxy.

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

- The SDK returns Clara DTOs from `@clara/api-contract`; harness domain types
  stay in the adapter and lab.
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
- For push, the hub opens the active adapter's harness event stream and stores
  Web Push subscriptions at `~/.config/clara/subscriptions.json`. VAPID keys
  live in `~/.config/clara/vapid.json`.
- The hub service serves `apps/hub/panel` on a second listener (default
  `127.0.0.1:8790`). It requires a superadmin session, provides first-run setup
  and harness configuration, reads one allowlisted runtime snapshot, exposes
  guarded controls for the four external features, the Go offline control,
  monitoring, the client-sync gate and cadence, and the local orchestration
  service, and never returns device keys, adapter credentials, tokens, push
  endpoints, sync values, or file contents. See
  [panel.md](../features/panel.md) and
  [hub-controls.md](../features/hub-controls.md).
- Harness adapters live in SQLite; exactly one is active. Each adapter connects
  out to the hub over the same local or relay WebSocket as a browser client.
  `HarnessManager` routes Clara Harness Protocol requests over that E2EE session,
  so the hub never contacts a harness directly and needs no adapter port.
  The included OpenCode adapter installs its daemon and orchestration binding
  together; the Claude Code adapter installs only its daemon and relies on the
  machine's Claude Code login. Session/project metadata is keyed by a stable harness identity, so a
  reinstall or re-pair reconnects the same sessions.
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

Sessions belong to a Clara project. A project is a container, not a directory:
its workspaces store one `(harness, directory)` pair each. Clara lists sessions
with `GET /v1/sessions?project=<clara-id>` so sessions moved to a worktree stay
in the project view. The `directory` filter is exact and is not used for the
session list.

A workspace's canonical directory is used to create sessions and to scope
location-specific data such as skills, references, and pending approvals. For an
open session, its `location.directory` wins when it differs from the workspace
directory.

A harness can keep more than one project record for the same canonical path, for
example before and after `git init`. Clara maps one workspace to every linked
record and merges their sessions and worktrees, so duplicate records cannot hide
work. When a workspace has no links yet, the hub resolves it through the harness
location once and retries; a project with no workspace on the active harness
returns `project_unmapped` instead of forwarding the Clara ID or showing an empty
list. Harness project lists never create Clara projects, and harness archive
state never hides one.

Sessions can report `projectID: "global"`. Session rows build links from the
route/selected project ID; notifications resolve the owning project, preferring
the session's project ID and falling back to a workspace directory.

Session-scoped endpoints (`messages`, `prompt`, `command`, `switchAgent`,
`switchModel`, `context`) take only the session ID; the server resolves the
directory from the session record. Moving a session to a worktree changes only
`location.directory`; its project ID stays the same.

## Host command policy

The browser has no generic shell path. Git history is the only host command
Clara runs: the hub's `/v1/git/log` endpoint builds a fixed `git log -n 10` with
a machine-readable `--format` from validated timestamps and the session
directory, sends it through the active adapter's shell capability, and returns
parsed commits. See [git.md](../features/git.md).

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

- The hub only exposes the typed `/v1` API. The browser has no generic harness
  proxy or shell path; the one host command is the fixed Git history endpoint.
- Never commit `service.json`, passwords, pairing codes, device keys, relay tokens,
  `secrets.key`, or `admin-setup.txt`.
- The hub's config is `~/.config/clara/server.json` (mode `0600`).
  Settings, client sync data, panel users, and harness connections live in
  `~/.local/share/clara/clara.db` (mode `0600`). Adapter credentials are
  encrypted with `secrets.key` (mode `0600`) or `CLARA_SECRET_KEY`, so the
  database alone does not expose them. The harness URL and password stay in the
  adapter's `config.json` (mode `0600`) on the adapter host, not in the hub
  database. `vapid.json`, `subscriptions.json`, and the temporary
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
  `Host`, `Origin`, and fetch metadata, and never returns device keys, adapter
  credentials, harness password, tokens, push endpoints, sync values, or file
  contents. The first-run
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
