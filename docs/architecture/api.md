# Hub API

The hub owns a versioned HTTP API at `/v1`. The browser reaches it through the
existing end-to-end encrypted WebSocket; local tools and the read-only MCP
reach it through a loopback HTTP listener.

```text
Browser / PWA
  └─ E2EE WebSocket ──▶ hub service ──▶ /v1 API ──▶ routed adapter ──▶ harness
MCP / local tools
  └─ loopback HTTP + bearer token ──▶ /v1 API
```

The browser never calls a harness directly. The hub only exposes `/v1`; there is
no generic `/api/*` proxy. Each request goes to one harness: the session's owner,
the workspace that holds the directory, an explicit `harnessID`, or the active
harness as the default.

## API surface

| Area        | Endpoints                                                                                                                                                                                                                                                                          |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Meta        | `GET /v1/info`, `GET /v1/harness/info`                                                                                                                                                                                                                                             |
| Harness     | `GET /v1/harnesses`, `POST /v1/harness/pairings`, `GET /v1/harness/adapters/:kind`                                                                                                                                                                                                 |
| Activity    | `GET /v1/activity/sessions`, `GET /v1/activity/running` (deprecated alias)                                                                                                                                                                                                         |
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

`GET /v1/events` streams one harness and requires `?harnessID=`. A client that
needs every harness opens one stream per online harness. The wire payloads are typed as the Clara `ClaraEvent` union from
`@clara/api-contract`; adapters translate their harness events into that union.
Web Push is supervised apart from the browser: while the hub runs, it keeps one
event stream per online harness, so a closed client is still notified for
sessions on any paired harness.

### Adapter setup

`POST /v1/harness/pairings` issues a one-time adapter code plus the registry
manifest, the one-line install command, and a `clara://adapter?code=…&kind=…`
desktop link. The body is
`{ "kind": "opencode|claude|pi", "method": "local" | "ssh" | "docker",
"transport": "local" | "relay" | "docker", "wsUrl": "ws://…", "opencodeUrl":
"http://…" }`. Every field except `kind` is optional. `method` describes where
the installer runs, `transport` overrides the relay/local/Docker choice derived
from it, and `wsUrl` sets a direct address for local or Docker transport. The hub
never runs the install: a browser user copies the command, while Clara Desktop
runs it through its loopback adapter host.

`GET /v1/harness/adapters/:kind` returns the registry manifest for one adapter.
The desktop client uses it when a `clara://` link carries a code but no manifest.
Both routes are device-authenticated like every other `/v1` call. The hub reads
the registry and never downloads the artifact.

### Harness routing

Every request is answered by one harness. The hub resolves it in this order:

1. An explicit `harnessID`, given as a query parameter or request field. A hint
   that names a harness that is no longer paired fails with `harness_missing`.
2. The session record, for session-scoped routes. Clara records which harness
   owns each session it has listed, so `messages`, `prompt`, `command`, `fork`,
   `view`, `context`, permissions, and forms need no hint. If the record is
   missing, the client must send `harnessID` or the request fails with
   `harness_required`.
3. The workspace that holds the directory, for directory-scoped routes such as
   files, VCS, skills, references, locations, git history, and permissions. If
   no workspace matches, or two harnesses link the same path, the request fails
   with `harness_required` or `harness_ambiguous` and lists the candidate
   `harnessIDs` instead of guessing across machines.

There is no fallback harness. Catalog, harness info, events, worktrees without a
project, and available-project requests must name their harness; the hub never
chooses the first paired or most recently used adapter.

`harnessID` is a hub routing hint and is never forwarded to the adapter. A
project list ignores it because that list always fans out; see below.
`POST /v1/sessions` accepts an optional `harnessID` and otherwise resolves the
parent session or a unique directory workspace. If none of those name a
harness, it fails with `harness_required`.

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
project ID and fan out to every harness that owns a record linked to the
project's workspaces. Each page is overlaid with the harness that produced it,
then merged, deduplicated, and ordered by `time.updated`. Paging uses a
hub-owned composite cursor that keeps one cursor per harness project record, so
every record is visited exactly once and no row repeats.

A harness that is offline, unpaired, or failing contributes no rows instead of
failing the whole list. When the project spans more than one harness, or any
harness failed, the response carries `harnesses[]` with `harnessID`, `label`,
`kind`, `online`, `ok`, and an error `code` and `message` for the failures. The
list fails with a harness error only when no linked harness answers at all.
`project_unmapped` is reserved for a project with no linked record on any paired
harness; an unlinked workspace is resolved once through the harness location and
retried before that error is returned. The hub never forwards a Clara ID to a
harness.

`GET /v1/git/log` is the only host command Clara runs, and it runs on the
workspace's harness, not on the hub host. The hub builds a fixed `git log`
command from validated timestamps and the session directory, resolves the
harness that owns that directory, and forwards the command through that
adapter's shell capability. There is no arbitrary shell endpoint.

### Cross-harness activity

`GET /v1/activity/sessions` is the read-only cross-harness view. Pass `project`
with a Clara project ID to scope the fan-out to that project: the hub resolves
the project's workspaces, reads only the harnesses that host them, overlays the
result with Clara project, title, archive, and snooze metadata, and keeps only
sessions whose overlaid project matches. Without `project`, the endpoint keeps
the legacy unscoped fan-out for older clients.

For each scoped harness it asks for `/sessions/active`, pending
`/permissions`, and every page of non-archived `/sessions`. The response contains
sessions in the Inbox or Outbox; archived and snoozed sessions are dropped.
Per-harness status stays in the response so offline or partially failing project
harnesses do not hide results from the others. Each session also carries mailbox
signals and, within the per-harness plan budget, its newest completed `todowrite`
plan from a bounded assistant-message page. Signal and plan lookups are cached
per harness and session; pass `?refresh=true` to bypass both caches. The browser
polls this endpoint rather than expecting a cross-harness event stream.

`GET /v1/activity/running` remains as a deprecated alias that returns only the
sessions the harness reports as running and accepts the same optional project
scope, so an older cached client still works.

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
`harness_unconfigured`, `harness_offline`, `harness_auth`, `harness_missing`,
`harness_ambiguous`, `upstream_error`, `upstream_invalid`, `project_unmapped`,
`project_exists`, and `not_found`. `harness_ambiguous` includes the candidate
`harnessIDs` in `details` so a caller can retry with an explicit scope.

## Read-only MCP

`packages/api/mcp` is a stdio MCP bridge to the loopback API. It exposes only read
tools, sends `x-clara-readonly: 1`, and is intended for agents testing frontend
code against live data.

```bash
clara start adapter --harness opencode --mcp-api
```

The installer adds `mcp.clara-api` to the OpenCode config. The bridge reads the
token from `CLARA_API_TOKEN_FILE` or the hub config directory and connects to
`CLARA_API_URL` (default `http://127.0.0.1:8788`).

## Related

- [overview.md](overview.md)
- [relay.md](relay.md)
- [e2ee.md](e2ee.md)
- [capabilities.md](../features/capabilities.md)
