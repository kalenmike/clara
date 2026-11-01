# Agent panel

## Summary

A loopback-only control panel served by the Clara home agent. It shows the
agent's live state, transports, connected clients, OpenCode probe, push health,
configuration sources, and storage files without exposing secrets. It is for the
person running the agent on the same machine.

## User flow

1. Start the home agent. The log prints
   `panel at http://127.0.0.1:8790/`.
2. Open that URL in a browser on the same machine. The panel connects to the
   agent's loopback API.
3. Read the six summary cards: agent process, OpenCode, local transport, relay,
   push, and effective configuration.
4. Review the connected-client table and the storage list. Status badges call
   out degraded OpenCode, relay, push, permissions, or missing files.
5. Leave the page open. It refreshes every five seconds while visible and pauses
   when the tab is hidden. Use **Refresh** for an immediate check.
6. If the agent is stopped or the panel is disabled, the page shows a clear
   error instead of a blank screen.

## Core business rules

1. **Loopback only.** The panel listens on `127.0.0.1` independently of
   `CLARA_LOCAL_HOST`, so exposing the local WebSocket on a LAN does not expose
   the panel. It is never served through the relay or the Pages deployment.
2. **Read-only.** v1 exposes only `GET` and `HEAD`. Every other method returns
   `405`, and there are no mutation endpoints.
3. **Secrets stay out.** The snapshot is built from an explicit allowlist. The
   PSK, pairing code, OpenCode password, relay tokens, push endpoints, and file
   contents are never returned. The PSK fingerprint, token presence, room id,
   and effective config values are shown.
4. **Browser drive-bys are rejected.** Requests must come from the loopback
   socket with a local `Host`, a same-origin `Origin` when present, and
   non-cross-site fetch metadata. No CORS headers are sent.
5. **The panel can fail without stopping the agent.** A busy port or missing
   build leaves the local WebSocket, relay, and push running.
6. **v1 does not persist settings.** There is no panel database or settings
   file yet. Connection settings continue to come from the environment,
   `server.json`, or OpenCode's `service.json`.

## Edge cases

- **OpenCode is down or rejects the password** — the OpenCode card shows
  unreachable, timed out, or auth rejected, with the last check time. The agent
  keeps running.
- **Relay is not configured** — the relay card explains local-only mode and the
  environment variables needed for remote access.
- **Relay reconnects** — the card shows the current state, last change, attempt
  count, and a redacted error.
- **Push is disabled** — the card shows the startup error and zero
  subscriptions.
- **No clients** — the client table shows an empty state.
- **Config permissions are broad** — storage warns when `server.json`,
  subscriptions, or VAPID keys are readable by other users.
- **The panel was not built** — the page returns a short instruction to run
  `pnpm build`; the JSON API still works.
- **Panel port is busy** — the agent logs `panel unavailable` and continues.
- **Panel assets were rebuilt while the agent is running** — restart the agent
  to load the new index file.
- **Panel is opened through a port forward** — it still works because the
  request reaches loopback, but remote access is not a supported feature.

## Out of scope

- Turning the relay on or off from the panel
- Kicking clients or revoking a device
- Feature flags or any other server-side setting mutation
- Editing `server.json`
- Authentication for the panel
- Remote access to the panel through the relay
- Historical metrics, persisted logs, or an audit trail

## Known gaps

- Any process on the machine, and any browser extension with loopback access,
  can read the panel. v1 assumes a single-user machine.
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
- API: `GET /panel/api/v1/status`
- Assets: `GET /assets/<hashed file>` and `GET /favicon.svg`
- Environment:
  - `CLARA_PANEL_PORT` changes the port (default `8790`)
  - `CLARA_PANEL_DISABLED=1` disables the panel
  - `CLARA_PANEL_DIR` overrides the built asset directory
- CLI: `clara-server serve --no-panel`
- Built assets: `apps/server/dist/panel`, copied from `apps/panel/dist`
- Dev UI: `pnpm dev:panel` (Vite on `5174`, proxying `/panel/api` to `8790`)
- Snapshot sections: agent, config, OpenCode, local transport, relay, clients,
  push, storage, events
- Guards: loopback remote address, `Host`, `Origin`, `Sec-Fetch-Site`,
  `GET`/`HEAD` only, path allowlist, CSP, `no-store`, no CORS
- Related: [overview](../architecture/overview.md),
  [pairing](pairing.md), [connection](connection.md),
  [notifications](notifications.md)

</details>
