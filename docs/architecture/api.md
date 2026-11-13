# Hub API

The hub owns a versioned HTTP API at `/v1`. The browser reaches it through the
existing end-to-end encrypted WebSocket; local tools and the read-only MCP
reach it through a loopback HTTP listener.

```text
Browser / PWA
  └─ E2EE WebSocket ──▶ hub service ──▶ /v1 API ──▶ active adapter ──▶ harness
MCP / local tools
  └─ loopback HTTP + bearer token ──▶ /v1 API
```

The browser never calls a harness directly. The hub only exposes `/v1`; there is
no generic `/api/*` proxy.

## API surface

| Area        | Endpoints                                                                                                                                                                                                                                                                          |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Meta        | `GET /v1/info`, `GET /v1/harness/info`                                                                                                                                                                                                                                             |
| Activity    | `GET /v1/activity/running`                                                                                                                                                                                                                                                         |
| Projects    | `GET /v1/projects`, `POST /v1/projects`, `PATCH/DELETE /v1/projects/:projectID`, `POST .../archive`, `.../unarchive`, `.../sync`, `.../workspaces`, `GET /v1/projects/available`, `GET /v1/harnesses`, `GET /v1/locations`                                                         |
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

`GET /v1/events` forwards the active adapter's Clara Harness Protocol SSE
stream. The wire payloads are typed as the Clara `ClaraEvent` union from
`@clara/api-contract`; adapters translate their harness events into that union.

### Projects and workspaces

Clara project IDs are hub-owned. A project is a container, not a directory. Its
workspaces are `(harness, directory)` links in `clara_project_workspaces`, and
`harness_project_links` maps each workspace to every harness project record for
that directory. `POST /v1/projects` creates the container by name;
`POST /v1/projects/:projectID/workspaces` adds a directory on a paired harness.
When the harness is online the hub resolves the directory through `locations`,
links every matching project record, and stores a snapshot for display. When it
is offline the workspace stays unresolved until `POST .../sync`.

Location-scoped adapter calls use a flat `directory` query parameter. The
adapter translates it into its harness's own wire shape; the hub must not send
OpenCode's nested `location[directory]` form. A harness project record has one
Clara owner: if a workspace resolves to a record already linked to another Clara
project, the hub reports `workspace_conflict` and leaves the existing links and
sessions alone. A successful sync removes links that the harness no longer
reports for that workspace.

`GET /v1/projects` reads Clara only; the harness project list never creates,
hides, or archives a Clara project. Harness archive state is therefore invisible
to Clara visibility. `POST .../archive` and `.../unarchive` set the Clara flag
and signal every linked harness; `DELETE ?mode=propagate` signals every linked
harness before removing the container, while `mode=disconnect` removes only
Clara state. Per-harness failures are returned in the result and do not roll back
the Clara action.

### Project-scoped lists

`GET /v1/sessions?project=` and `GET /v1/worktrees?project=` accept a Clara
project ID and map it to every harness project record linked to the project's
workspaces on the active harness. Sessions are merged, deduplicated, and ordered
by `time.updated`. A project linked to more than one record requests up to
`limit` rows per record and uses a hub-owned composite cursor, so paging still
visits every record exactly once. When a workspace has no links, the hub resolves
it from the harness location once and retries; a project with no workspace on the
active harness returns `project_unmapped`; the hub never forwards a Clara ID to
the harness.

`GET /v1/git/log` is the only host command Clara runs. The hub builds a fixed
`git log` command from validated timestamps and the session directory; there is
no arbitrary shell endpoint.

### Cross-harness running activity

`GET /v1/activity/running` is the read-only exception to active-harness scoping.
It asks every paired harness for `/sessions/active`, reads each running session,
and overlays the result with its Clara project and workspace links. It also reads
the session context to return the newest completed `todowrite` plan. The response
keeps per-harness status so offline or partially failing harnesses do not hide
results from the others. Transcript lookups are cached briefly per harness and
session; pass `?refresh=true` to bypass that cache. The browser polls this
endpoint rather than expecting a cross-harness event stream.

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
- Response schemas are Clara-owned zod schemas in `@clara/api-contract`,
  registered directly with `hono-openapi`'s resolver. There is no generated
  schema file or regeneration step.

`@opencode/client` is an implementation detail of `apps/adapters/opencode` and `tools/lab`. The hub has no OpenCode dependency.
The web, `@clara/api-client`, and `@clara/api-contract` use the Clara DTOs and
must not import it.

## Client SDK

`@clara/api-client` is a fetch-based SDK for the hub API. It follows the familiar
harness method names but returns Clara DTOs from `@clara/api-contract`. Pass the
E2EE transport's `fetch` in the browser, or global `fetch` with a bearer header
in Node and MCP tools.

```ts
const client = createClaraClient({ fetch: transport.fetch })

const projects = await client.project.list()
const session = await client.session.get({ sessionID })
for await (const event of client.event.subscribe()) {
  // handle a ClaraEvent
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

Common codes are `unauthorized`, `read_only`, `disabled`,
`harness_unconfigured`, `harness_offline`, `harness_auth`, `upstream_error`,
`upstream_invalid`, `project_unmapped`, `project_exists`, `harness_missing`, and
`not_found`.

## Read-only MCP

`packages/api/mcp` is a stdio MCP bridge to the loopback API. It exposes only read
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
