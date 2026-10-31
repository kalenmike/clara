# Connection

## Summary

Lets a person point Clara at a running OpenCode server and proves the connection
before showing any project data. It is the first screen for every new browser and
the place to recover when the server restarts or credentials change.

## User flow

1. Start OpenCode with `opencode service start`, then open Clara. On first load
   it looks for that local service through the dev proxy and connects
   automatically when it answers. A foreground `opencode serve` is not detected
   this way.
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
8. **Settings → Reconnect** re-proves the current server and restarts the event
   stream without clearing credentials. The sidebar health control offers the
   same action when the stream is not live, and the Server card shows the stream
   state and the last stream error.
9. **Settings → Disconnect** clears the stored connection and returns to this
   screen.

## Core business rules

1. Clara talks to one server at a time. Connecting again replaces the current
   client, clears cached queries when the server changes, and restarts the event
   stream.
2. OpenCode uses HTTP basic auth with the fixed user `opencode`; the password is
   required for every request, including the event stream.
3. Credentials live in `sessionStorage` by default. They move to `localStorage`
   only when the person checks "remember".
4. A stored connection is retried on boot before the local service is considered.
5. The local proxy only finds a server registered in `service.json` by
   `opencode service start`. A foreground `opencode serve` does not write that
   file, so it must be connected manually with its URL, the password printed at
   startup, and a CORS entry for Clara's origin. Production builds must use
   manual credentials or an operator-controlled reverse proxy.
6. Reconnect keeps the stored configuration and the current client while it
   probes. A failed reconnect reports the error but does not sign the person out.
7. The event stream is healthy only while chunks keep arriving. The server sends
   a heartbeat every 15 seconds; 45 seconds of silence is treated as a dead
   connection and reconnected.

## Edge cases

- **401** — the form reports an authentication failure; the URL is kept.
- **Server down or wrong port** — a network error explains that the URL, CORS, or
  process may be wrong.
- **502 from the local proxy** — `service.json` points at a stopped or restarted
  service. Run `opencode service start`; a foreground `opencode serve` on `4096`
  will not update that file, so connect to it manually instead.
- **CORS rejection** — the alert points at `opencode serve --cors <origin>`.
- **No local service** — the local card is hidden; manual connection still works.
- **Stale stored connection** — Clara falls back to the connect screen with the
  previous URL prefilled; it does not silently try another server.
- **Malformed URL** — the form trims trailing slashes and the request fails
  visibly rather than crashing the app.
- **Local detection timeout** — the probe gives up after 2.5 seconds.
- **Password contains non-ASCII characters** — auth is encoded as UTF-8 before
  base64.
- **Stalled stream** — a half-open connection produces no error; the heartbeat
  watchdog aborts it and reconnects with backoff. The sidebar shows Retry while
  the stream is down.
- **Manual reconnect fails** — the current client and credentials are kept, the
  Settings card shows the error, and the stream keeps retrying.
- **Local service restarts** — the dev and preview proxies read `service.json`
  per request, so a new port and password are picked up without a Vite restart.
- **Provider failure** — a run that fails at the model provider is not a
  connection failure. The assistant message shows the provider error and the
  stream stays live.

## Out of scope

- Pairing links or cookie-based browser sessions
- Multiple saved server profiles or switching without disconnecting
- OAuth or provider credential management
- A production proxy shipped with Clara

## Known gaps

- Reconnect re-proves the server and restarts the stream; it is not a separate
  dry-run test that leaves the connection untouched.
- The connect screen does not show the server's full URL list after success;
  Settings does.

## Technical appendix

<details>
<summary>Routes, data, and references</summary>

- Route: `/connect`
- Probe: `GET /api/info` (version, pid, urls, capabilities), 8s timeout on
  connect, 5s on reconnect
- Client factory: `createClient` in `src/lib/client.ts`
- Reconnect: re-probes the stored config, installs a new client, bumps a
  generation counter, and invalidates cached queries
- Stream health: `onActivity` tracks every chunk, including the 15s heartbeat;
  the watchdog aborts after 45s of silence
- Storage keys: `clara.connection.local`, `clara.connection.session`
- Dev proxy: a Vite middleware reads
  `${XDG_STATE_HOME:-~/.local/state}/opencode/service.json` on each request and
  forwards `/oc/*` with the basic-auth header. It runs in both `vite` and
  `vite preview`, so a restarted service is picked up without restarting Vite.
  Only `opencode service start` (or another service-mode process) writes that
  registration; `opencode serve` runs on `4096` by default and prints its
  password but does not register itself.
- Related: [architecture overview](../architecture/overview.md)

</details>
