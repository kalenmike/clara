# Connection

## Summary

Lets a person point Clara at a running OpenCode server and proves the connection
before showing any project data. It is the first screen for every new browser and
the place to recover when the server restarts or credentials change.

## User flow

1. Open Clara. On first load it looks for a local OpenCode service through the
   dev proxy and connects automatically when one answers.
2. If nothing answers, the connect screen shows a server URL field, a password
   field, and a "remember this connection" checkbox.
3. When a local service is detected, a card shows its version and process ID with
   a "Use local" button.
4. The person can instead enter any OpenCode 2 server URL and the password from
   its `service.json`.
5. Press **Connect**. Clara calls the server's info endpoint and shows a spinner
   while it waits.
6. On success Clara stores the connection and opens the last project, or the
   first project the server returns.
7. On failure the form stays filled and an alert explains whether the problem was
   authentication, reachability, or CORS.
8. **Settings → Disconnect** clears the stored connection and returns to this
   screen.

## Core business rules

1. Clara talks to one server at a time. Connecting again replaces the current
   client and clears cached queries.
2. OpenCode uses HTTP basic auth with the fixed user `opencode`; the password is
   required for every request, including the event stream.
3. Credentials live in `sessionStorage` by default. They move to `localStorage`
   only when the person checks "remember".
4. A stored connection is retried on boot before the local service is considered.
5. The local proxy is a development convenience. Production builds must use
   manual credentials or an operator-controlled reverse proxy.

## Edge cases

- **401** — the form reports an authentication failure; the URL is kept.
- **Server down or wrong port** — a network error explains that the URL, CORS, or
  process may be wrong.
- **CORS rejection** — the alert points at `opencode serve --cors <origin>`.
- **No local service** — the local card is hidden; manual connection still works.
- **Stale stored connection** — Clara falls back to the connect screen with the
  previous URL prefilled; it does not silently try another server.
- **Malformed URL** — the form trims trailing slashes and the request fails
  visibly rather than crashing the app.
- **Local detection timeout** — the probe gives up after 2.5 seconds.
- **Password contains non-ASCII characters** — auth is encoded as UTF-8 before
  base64.

## Out of scope

- Pairing links or cookie-based browser sessions
- Multiple saved server profiles or switching without disconnecting
- OAuth or provider credential management
- A production proxy shipped with Clara

## Known gaps

- There is no explicit "test connection" button separate from connecting.
- The connect screen does not show the server's full URL list after success;
  Settings does.

## Technical appendix

<details>
<summary>Routes, data, and references</summary>

- Route: `/connect`
- Probe: `GET /api/info` (version, pid, urls, capabilities)
- Client factory: `createClient` in `src/lib/client.ts`
- Storage keys: `clara.connection.local`, `clara.connection.session`
- Dev proxy: Vite maps `/oc/*` to the service URL from
  `${XDG_STATE_HOME:-~/.local/state}/opencode/service.json` and adds the
  basic-auth header.
- Related: [architecture overview](../architecture/overview.md)

</details>
