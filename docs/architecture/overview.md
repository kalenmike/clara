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

Clara supports two modes:

- **Local proxy** — the Vite dev server reads `service.json` and proxies `/oc`
  to the service URL with the `authorization` header attached. The browser never
  sees the password. This is the default in development when a local service is
  running.
- **Manual** — the user enters a URL and password on `/connect`. The SDK sends
  the basic-auth header on every request, including the SSE stream. Credentials
  live in `sessionStorage` unless "remember" is checked, in which case they go to
  `localStorage`.

Remote servers must allow the Clara origin. Start them with
`opencode serve --cors <origin>`; OpenCode answers preflight requests with the
matching `Access-Control-Allow-Origin`.

## Runtime shape

```text
ConnectionProvider
  └─ creates the SDK client from baseUrl + credentials
       ├─ TanStack Query: projects, sessions, messages, catalog, approvals
       └─ EventProvider: one SSE subscription for the whole tab
            ├─ chatStore: applies streaming deltas per session
            └─ query invalidations: durable events and list changes
```

- **`chatStore`** keeps a snapshot per session (messages, status, cost, tokens)
  and batches notifications with `requestAnimationFrame`. The chat page renders
  from it; history queries hydrate it.
- **TanStack Query** owns everything that is requested on demand. Event handlers
  invalidate the relevant keys instead of duplicating server state.
- **EventProvider** reconnects with exponential backoff. It tolerates unknown
  event types so a newer server does not break the tab.

## Routing

| Route                        | Screen                                                  |
| ---------------------------- | ------------------------------------------------------- |
| `/connect`                   | Server form, local service detection, connection errors |
| `/`                          | Redirects to the last project or the first project      |
| `/p/:projectId`              | Project overview and session grid                       |
| `/p/:projectId/s/:sessionId` | Chat                                                    |
| `/settings`                  | Connection details, appearance, shortcuts               |

## Directory scoping

The server scopes sessions and catalogs by directory. Two behaviors matter:

- `GET /api/session?project=<id>` does **not** return the project's sessions in
  2.1.1. Clara lists them with `?directory=<project.canonical>`.
- Sessions returned by a directory query can report `projectID: "global"`.
  Clara therefore uses the route/selected project ID for links, not the session's
  `projectID`.

Session-scoped endpoints (`messages`, `prompt`, `command`, `switchAgent`,
`switchModel`, `context`) take only the session ID; the server resolves the
directory from the session record.

## Streaming model

The event stream is the source of truth while a run is active:

- `session.step.started` creates the assistant message.
- `session.text.*` and `session.reasoning.*` append to content parts by ordinal.
- `session.tool.*` maintains tool cards and their input/output.
- `session.usage.updated` and `session.step.ended` update cost and tokens.
- `session.status`, `session.execution.*`, and `session.idle` drive the run badge.
- Durable events (synthetic notes, skills, shell, agent/model switches) trigger a
  debounced message refetch.

A refetch on idle reconciles the stream with persisted history.

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
