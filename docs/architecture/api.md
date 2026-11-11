# Hub API

The hub owns a versioned HTTP API at `/v1`. The browser reaches it through the
existing end-to-end encrypted WebSocket; local tools and the read-only MCP
reach it through a loopback HTTP listener.

```text
Browser / PWA
  └─ E2EE WebSocket ──▶ hub service ──▶ /v1 API ──▶ active harness ──▶ OpenCode
MCP / local tools
  └─ loopback HTTP + bearer token ──▶ /v1 API
```

The browser never calls OpenCode directly. The old `/api/*` proxy is being
retired in phases; during the migration the hub routes `/v1/*` to the API and
keeps `/api/*` on the legacy path.

## API surface

| Area        | Endpoints                                                                                                                                                                                                                                                                          |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Meta        | `GET /v1/info`, `GET /v1/harness/info`                                                                                                                                                                                                                                             |
| Projects    | `GET /v1/projects`, `PATCH /v1/projects/:projectID`, `GET /v1/locations`                                                                                                                                                                                                           |
| Sessions    | `GET /v1/sessions`, `POST /v1/sessions`, `GET /v1/sessions/active`, `GET/PATCH/DELETE /v1/sessions/:sessionID`, `POST .../fork`, `.../move`, `.../view`, `.../prompt`, `.../synthetic`, `.../command`, `.../interrupt`, `.../compact`, `.../agent`, `.../model`, `GET .../context` |
| Messages    | `GET /v1/sessions/:sessionID/messages`                                                                                                                                                                                                                                             |
| Forms       | `GET /v1/sessions/:sessionID/forms`, `POST .../forms/:formID/reply`, `DELETE .../forms/:formID`                                                                                                                                                                                    |
| Inbox       | `GET /v1/sessions/:sessionID/inbox`, `DELETE .../inbox/:inboxID`                                                                                                                                                                                                                   |
| Permissions | `GET /v1/permissions`, `POST /v1/sessions/:sessionID/permissions/:requestID/reply`                                                                                                                                                                                                 |
| Catalog     | `GET /v1/agents`, `/v1/models`, `/v1/providers`, `/v1/commands`, `/v1/skills`, `/v1/references`                                                                                                                                                                                    |
| Files       | `GET /v1/files/find`                                                                                                                                                                                                                                                               |
| VCS         | `GET /v1/vcs`, `/v1/vcs/base`, `/v1/vcs/status`, `/v1/vcs/diff`                                                                                                                                                                                                                    |
| Worktrees   | `GET /v1/worktrees`, `POST /v1/worktrees/refresh`                                                                                                                                                                                                                                  |
| Clara       | `GET /v1/git/log`, `GET /v1/events`                                                                                                                                                                                                                                                |

`GET /v1/events` forwards the harness SSE stream. The event payloads are the
OpenCode `V2Event` union from `@opencode/client`.

`GET /v1/git/log` is the only host command Clara runs. The hub builds a fixed
`git log` command from validated timestamps and the session directory; there is
no arbitrary shell endpoint.

## Authentication

| Transport        | Authentication                          |
| ---------------- | --------------------------------------- |
| WebSocket        | E2EE device session                     |
| Loopback HTTP    | `Authorization: Bearer <token>`         |
| Read-only client | bearer token plus `x-clara-readonly: 1` |

The hub generates `api.token` in the hub config directory with mode `0600`. Set
`CLARA_API_TOKEN` or `CLARA_API_TOKEN_FILE` to override it. The browser never
receives the token.

The WebSocket bridge marks its internal API requests with `x-clara-agent: 1`.
The loopback adapter strips that header before forwarding, so a local HTTP
client cannot bypass the bearer token by forging it.

The API rejects non-GET methods when the read-only header is present. The
read-only MCP uses that header for every call.

## OpenAPI and Swagger

- `GET /openapi.json` returns the OpenAPI 3.1 document.
- `GET /docs` serves Swagger UI.
- Request params, queries, and bodies are zod-validated.
- Response schemas are generated from the pinned `@opencode/client` types by
  `ts-json-schema-generator`, so the document matches the targeted OpenCode
  version.

Regenerate the components after bumping `@opencode/client`:

```bash
pnpm --filter @clara/api-contract generate:schemas
```

## Client SDK

`@clara/api-client` is a fetch-based SDK for the hub API. It mirrors the
OpenCode client method names and return types, so the web migration is mostly a
client swap. Pass the E2EE transport's `fetch` in the browser, or global `fetch`
with a bearer header in Node and MCP tools.

```ts
const client = createClaraClient({ fetch: transport.fetch })

const projects = await client.project.list()
const session = await client.session.get({ sessionID })
for await (const event of client.event.subscribe()) {
  // handle a V2Event
}
```

`ClaraApiError` carries `status`, `code`, `message`, and `details`.

## Errors

Errors use one envelope:

```json
{
  "error": {
    "code": "harness_unconfigured",
    "message": "No harness connection is configured. Set one up in the hub panel."
  }
}
```

Common codes are `unauthorized`, `read_only`, `disabled`, `harness_unconfigured`,
`harness_auth`, `upstream_error`, `upstream_invalid`, and `not_found`.

## Read-only MCP

`apps/api-mcp` is a stdio MCP bridge to the loopback API. It exposes only read
tools, sends `x-clara-readonly: 1`, and is intended for agents testing frontend
code against live data.

```bash
pnpm clara mcp install --api
```

The installer adds `mcp.clara-api` to the OpenCode config. The bridge reads the
token from `CLARA_API_TOKEN_FILE` or the hub config directory and connects to
`CLARA_API_URL` (default `http://127.0.0.1:8788`).

## Related

- [overview.md](overview.md)
- [relay.md](relay.md)
- [e2ee.md](e2ee.md)
- [capabilities.md](../features/capabilities.md)
