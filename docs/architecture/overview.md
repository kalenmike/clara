# Architecture overview

Clara is a browser client for one running OpenCode server. It reads projects,
sessions, and messages over the OpenCode 2 HTTP API, then keeps the open session
in sync through the server's event stream.

## Stack

| Layer        | Choice                                                                |
| ------------ | --------------------------------------------------------------------- |
| Build        | Vite 8, TypeScript 6                                                  |
| UI           | React 19, React Router 8                                              |
| Styles       | Tailwind CSS 4, shadcn/ui (radix-nova), Lucide                        |
| Server state | TanStack Query 5                                                      |
| Stream state | A small external store (`chatStore`) read with `useSyncExternalStore` |
| OpenCode     | `@opencode/client` **2.1.1**, pinned to the server minor              |

### Version contract

The API is generated per OpenCode release. Clara pins `@opencode/client` to the
same version as the server it targets (2.1.1). Before bumping either side:

1. Check the server's `/openapi.json` for endpoint or payload changes.
2. Update the client package to the same version.
3. Run `pnpm check` and re-test connect, stream, send, and switch flows.

`@opencode-ai/sdk` is not used: that package targets the v1 API and does not
match the v2 server. `@opencode/sdk` bundles an embedded Node server and is not
browser-safe, so Clara uses the browser client from the same family.

## Connecting

OpenCode 2 servers require HTTP basic auth with the `opencode` user. The
password lives in the service state file:

```text
${XDG_STATE_HOME:-~/.local/state}/opencode/service.json
```

Clara supports two modes, and the startup command decides which one works:

| Start OpenCode with              | Mode        | Result                                                                                   |
| -------------------------------- | ----------- | ---------------------------------------------------------------------------------------- |
| `opencode service start`         | Local proxy | The service registers its URL and password in `service.json`; Clara auto-detects it.     |
| `opencode serve --cors <origin>` | Manual      | The server stays unregistered; connect with its URL and the password printed at startup. |

- **Local proxy** — the Vite dev server reads `service.json` on each request and
  proxies `/oc` to the service URL with the `authorization` header attached. The
  browser never sees the password. This is the default in development when a
  local service is running, and it works in `vite preview` too. Only a server
  registered by the background service (`opencode service start`) appears here.
  A plain `opencode serve` does not write `service.json`.
- **Manual** — the user enters a URL and password on `/connect`. The SDK sends
  the basic-auth header on every request, including the SSE stream. Credentials
  live in `sessionStorage` unless "remember" is checked, in which case they go to
  `localStorage`. Use this mode for a foreground `opencode serve`, which listens
  on `4096` by default and prints its password as `server password …`.

Remote servers must allow the Clara origin. Start them with
`opencode serve --cors <origin>`; OpenCode answers preflight requests with the
matching `Access-Control-Allow-Origin`. The proxy path is same-origin, so it
needs no CORS entry.

## Runtime shape

```text
ConnectionProvider
  └─ creates the SDK client from baseUrl + credentials
       ├─ TanStack Query: projects, sessions, messages, catalog, approvals
       └─ EventProvider: one SSE subscription for the whole tab
            ├─ chatStore: applies streaming deltas per session
            └─ query invalidations: durable events and list changes
                 └─ NotificationProvider: system alerts and sounds for Inbox states
```

- **`chatStore`** keeps a snapshot per session (messages, status, cost, tokens)
  and batches notifications with `requestAnimationFrame`. The chat page renders
  from it; history queries hydrate it.
- **TanStack Query** owns everything that is requested on demand. Event handlers
  invalidate the relevant keys instead of duplicating server state.
- **EventProvider** reconnects with jittered exponential backoff, treats 45s
  without a heartbeat as a dead stream, and invalidates cached queries after a
  reconnect so missed events do not leave the UI stale. It tolerates unknown
  event types so a newer server does not break the tab.

## Routing

| Route                        | Screen                                                     |
| ---------------------------- | ---------------------------------------------------------- |
| `/connect`                   | Server form, local service detection, connection errors    |
| `/`                          | Start view; creates a session and opens its draft composer |
| `/p/:projectId`              | Project overview and session grid                          |
| `/p/:projectId/s/:sessionId` | Chat                                                       |
| `/settings`                  | Connection details, appearance, notifications, shortcuts   |

The start view is reused inside `/p/:projectId/s/:sessionId` when the session has
no messages. Its action opens the reply window in the last-used size (expanded by
default) instead of creating another session. The start view at `/` creates a
session first, then navigates to it with the composer already open at that size.

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

## Streaming model

The event stream is the source of truth while a run is active:

- `session.step.started` creates the assistant message.
- `session.text.*` and `session.reasoning.*` append to content parts by ordinal.
- `session.tool.*` maintains tool cards and their input/output.
  `session.tool.progress` carries streamed shell output used by the pair
  terminal.
- `session.usage.updated` and `session.step.ended` update cost and tokens.
- `session.status`, `session.execution.*`, and `session.idle` drive the run badge
  and refresh the active-session map used by the sidebar's live dot and Outbox.
  The notification provider also uses these events to raise Inbox alerts.
- Durable events (synthetic notes, skills, shell, agent/model switches) trigger a
  debounced message refetch.
- `session.step.failed` and `session.execution.failed` attach the provider error
  to the assistant turn. The chat renders it at every detail level and raises a
  toast, so a failed run never looks like silence.

A refetch on idle reconciles the stream with persisted history, and a reconnect
invalidates the queries that missed events would have refreshed.

## Security notes

- Never commit `service.json`, passwords, or a `.env` holding credentials.
- The local proxy exists only in the Vite dev server. Production builds use
  manual credentials or a reverse proxy the operator controls.
- Clara has no server-side component and no telemetry.

## Related

- [Feature guide](../features/GUIDE.md)
- [Capabilities](../features/capabilities.md)
- [Connection](../features/connection.md)
- [Chat](../features/chat.md)
