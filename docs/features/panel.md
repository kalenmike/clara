# Agent panel

## Summary

A loopback-only control panel served by the Clara home agent. It shows the
agent's live state, transports, connected clients, OpenCode probe, push health,
configuration sources, database health, and storage files without exposing
secrets. It also lets the person at the machine switch external connections on
and off and stop the agent without stopping the process.

## User flow

1. Start the home agent. The log prints
   `panel at http://127.0.0.1:8790/`.
2. Open that URL in a browser on the same machine. The panel connects to the
   agent's loopback API.
3. Review the summary cards: agent process, OpenCode, local transport, relay,
   push, and effective configuration.
4. In **Agent controls**, toggle OpenCode, local transport, relay, or push. Each
   switch shows the saved choice and whether it is effective.
5. To take every external connection offline, choose **Stop agent** and confirm.
   The page keeps polling; the banner explains that the panel is still available.
6. Choose **Start agent** to restore the saved choices. Feature switches are
   disabled until the agent is started again.
7. Review the connected-client table and the storage list. Status badges call
   out degraded OpenCode, relay, push, permissions, or missing files.
8. Leave the page open. It refreshes every five seconds while visible and pauses
   when the tab is hidden. Use **Refresh** for an immediate check.

## Core business rules

1. **Loopback only.** The panel listens on `127.0.0.1` independently of
   `CLARA_LOCAL_HOST`, so exposing the local WebSocket on a LAN does not expose
   the panel. It is never served through the relay or the Pages deployment.
2. **Reads are open to loopback; writes are narrow.** `GET` and `HEAD` serve the
   snapshot and assets. `POST` is accepted only at
   `/panel/api/v1/features` and `/panel/api/v1/agent`; every other mutating
   method returns `405`.
3. **Secrets stay out.** The snapshot is built from an explicit allowlist. The
   PSK, pairing code, OpenCode password, relay tokens, push endpoints, sync
   values, and file contents are never returned. The PSK fingerprint, token
   presence, room id, and effective config values are shown.
4. **Mutations are browser-hard to forge.** Besides the loopback, `Host`,
   `Origin`, and `Sec-Fetch-Site` checks, writes require
   `content-type: application/json` and `x-clara-panel: 1`, reject unknown
   fields, and cap the body at 8 KB. The custom header forces a CORS preflight
   for cross-origin pages, which the server rejects. No CORS headers are sent.
5. **Settings are durable.** Feature choices and the stopped flag live in the
   agent's SQLite database and are loaded before any transport starts. The panel
   can fail without stopping the agent; a busy panel port only loses the panel.

## Edge cases

- **OpenCode is down or rejects the password** — the OpenCode card shows
  unreachable, timed out, or auth rejected, with the last check time. The agent
  keeps running.
- **OpenCode is turned off** — the card says disabled, the probe is not run, and
  proxied requests fail with a disabled error. Local and relay clients stay
  connected.
- **Local transport is off** — the card says off and the listener closes its
  clients with a clear reason. Turning it on starts a fresh listener.
- **Relay is not configured** — the relay card explains local-only mode and the
  environment variables needed for remote access.
- **Relay reconnects** — the card shows the current state, last change, attempt
  count, and a redacted error.
- **Push is off or unavailable** — the card shows the saved choice, the
  effective state, the startup error, and the subscription count. Existing
  subscriptions are kept.
- **The agent is stopped** — a banner says external connections are off, every
  transport card shows a stopped state, and feature switches are disabled.
- **A feature fails to start** — the saved choice remains, the card shows the
  error, and the rest of the agent keeps running.
- **No clients** — the client table shows an empty state.
- **Config permissions are broad** — storage warns when the database,
  `server.json`, subscriptions, or VAPID keys are readable by other users.
- **The panel was not built** — the page returns a short instruction to run
  `pnpm build`; the JSON API still works.
- **Panel port is busy** — the agent logs `panel unavailable` and continues.

## Out of scope

- Authentication or multi-user accounts for the panel
- Remote access to the panel through the relay
- Editing connection URLs, ports, rooms, tokens, or `server.json` from the panel
- Kicking clients or revoking a device
- Historical metrics, persisted logs, or an audit trail
- A sync settings page (server storage exists, the web UI does not)

## Known gaps

- Loopback is not user isolation. Any process on the machine, and any browser
  extension with loopback access, can read and change the panel.
- There is no per-device identity; the panel shows one entry per live E2EE
  session.
- The activity list is in memory and resets when the agent restarts.
- The OpenCode probe is cached for five seconds, so the card can briefly lag a
  restart.

## Technical appendix

<details>
<summary>Routes, data, and references</summary>

- Panel listener: `127.0.0.1:8790` by default
- Page: `GET /`
- Read API: `GET /panel/api/v1/status` (API version `2`)
- Mutations:
  - `POST /panel/api/v1/features` with `{ "feature": "...", "enabled": true }`
  - `POST /panel/api/v1/agent` with `{ "stopped": true }`
- Required mutation headers: `content-type: application/json`,
  `x-clara-panel: 1`
- Assets: `GET /assets/<hashed file>` and `GET /favicon.svg`
- Environment:
  - `CLARA_PANEL_PORT` changes the port (default `8790`)
  - `CLARA_PANEL_DISABLED=1` disables the panel
  - `CLARA_PANEL_DIR` overrides the built asset directory
  - `CLARA_DB_PATH` moves the database (default `<config dir>/clara.db`)
- CLI: `clara-server serve --no-panel`
- Built assets: `apps/server/dist/panel`, copied from `apps/panel/dist`
- Dev UI: `pnpm dev:panel` (Vite on `5174`, proxying `/panel/api` to `8790`)
- Snapshot sections: agent, config, OpenCode, local transport, relay, clients,
  push, controls, storage, events
- Database health: path, existence, mode, bytes, schema version, client-sync
  counts and bytes (never values)
- Guards: loopback remote address, `Host`, `Origin`, `Sec-Fetch-Site`,
  `GET`/`HEAD` reads, two guarded `POST` routes, path allowlist, CSP, `no-store`,
  no CORS
- Related: [agent-controls.md](agent-controls.md), [sync.md](sync.md),
  [overview.md](../architecture/overview.md), [pairing.md](pairing.md),
  [connection.md](connection.md), [notifications.md](notifications.md)

</details>
