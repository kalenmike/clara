# Hub controls

## Summary

The hub keeps its process, panel, and database alive while an admin switches its
external connections on or off from the hub panel. The panel also starts and
stops the local orchestration service and owns the global gate and check cadence
for client settings sync.

## User flow

1. Open the panel at `http://127.0.0.1:8790/` on the machine running the hub service and sign in with the superadmin account.
2. The **Hub**, **Effective configuration**, **Connected clients**, and
   **Recent activity** cards start expanded; every other card starts collapsed.
   Click a card header to expand or collapse it.
3. Each transport card carries its own switch at the top right: OpenCode
   connection, local transport, relay, and push notifications. The status chip
   sits beside the card title.
4. Toggle one feature. The panel posts the change, waits for the hub service to
   apply it, then refreshes the snapshot. A disabled feature hides its details
   and its header cannot be expanded; enabling it makes the header expandable.
5. Read the **Desired** and **Effective** values on the switch and on the
   matching transport card. A failed start shows an error instead of pretending
   the feature works.
6. In **Client sync**, turn settings sync on or off and choose the client check
   interval. Turning it off hides the web Sync tab and rejects sync requests;
   stored values and per-device category choices are kept.
7. Choose **Go offline** at the top right of the **Hub** card and confirm.
   All external connections close, the E2EE sessions are reset, and the page
   shows the offline banner.
8. While connections are off, feature switches are disabled. Choose **Go
   online** in the same place to restore every saved on/off choice,
   including features that were off before the stop. The shell policy,
   monitoring, client-sync, and orchestration controls stay editable because
   they do not start a Clara transport.
9. Use **Orchestration** to start or stop the local service. Container and
   external instances are detected and left alone.
10. Restart the process at any time; the saved choices and the stopped
    connections setting are loaded before any transport starts.

## Core business rules

1. **Two layers.** _Desired_ is the saved user choice. _Effective_ is true only
   when the choice is on, connections are not stopped, and the transport
   actually started. The panel always shows both.
2. **Going offline does not change preferences.** Go offline closes OpenCode access,
   the local listener, the relay socket, and the push monitor, but leaves the
   saved feature choices alone. Starting reapplies them.
3. **The panel outlives the hub's connections.** Go offline keeps the process,
   the loopback panel, and the database alive. It is not the systemd stop action
   and it does not exit the process.
4. **Failures are reported, not fatal.** If a port is busy, the relay is
   unavailable, or push keys are invalid, the desired value is still saved and
   the panel reports an error with `effective: false`. The process keeps running.
5. **Dependencies are visible.** Turning OpenCode off stops the push event
   monitor but leaves the local and relay transports connected. Push actions are
   gated separately.
6. **Cards are accordions.** Hub, effective configuration, connected clients,
   and recent activity start expanded; every other card starts collapsed. Each
   opens from its header. A disabled feature hides its details and cannot be
   opened; the header keeps the switch and status chip. The shell card is
   expandable while its switch is on, and the switch stays amber until Apply
   saves the draft. The client-sync card keeps its interval select editable even
   while the global sync gate is off, so the cadence can be prepared before sync
   is enabled.

## Edge cases

- **Started with connections off** — only the panel and database start. The log
  says the hub was started with connections off by an admin setting, and every
  transport stays off.
- **Feature change while stopped** — the panel disables the feature switches,
  the API returns `409`, and enabled cards remain readable; the saved choices
  cannot drift while connections are off. The separate shell policy, monitoring,
  and client-sync controls stay editable.
- **Local port busy** — the saved local setting stays on, the listener reports
  `effective: false`, and retrying after the port is free starts a fresh
  listener.
- **Relay not configured** — enabling it records the choice and reports an error;
  the relay card explains that a URL and both tokens are required.
- **Push unavailable** — a VAPID or subscription-file failure leaves the switch
  on but ineffective, with the startup error. Existing subscriptions are kept.
- **OpenCode down** — the OpenCode probe reports unreachable while the hub is
  running and the other transports stay up.
- **Panel port busy** — the panel logs `panel unavailable` and the hub service
  keeps its other connections; restart the process after freeing the port.
- **Database cannot open** — startup fails with an error naming the database
  path; the hub service does not silently fall back to defaults.

## Out of scope

- Stopping or restarting the systemd unit from the panel
- Editing `server.json`, the OpenCode URL, ports, rooms, or tokens from the panel
- Kicking clients or revoking a device
- Historical metrics or a persisted audit trail
- Remote access to the panel through the relay or Pages
- Sandboxing command execution; see [panel](panel.md) for the separate shell
  policy and its limits

## Known gaps

- Authentication is not host isolation. Any process with the panel cookie or
  the database and secret key can still change the controls.
- A relay that is enabled but unreachable keeps retrying; the switch reads
  effective while the relay card shows reconnecting or offline.
- The panel is authenticated, but its `Host`/`Origin` guard still expects a
  loopback origin. Use an SSH tunnel for remote access; direct LAN access is not
  enabled in this phase.

## Technical appendix

<details>
<summary>Routes, data, and references</summary>

- Settings file: `CLARA_DB_PATH` or `<CLARA_DATA_DIR>/clara.db` (mode `0600`)
- Settings keys: `features.opencode`, `features.local`, `features.relay`,
  `features.push`, `agent.stopped` (the historical key for stopped
  connections), `shell.mode` and `shell.commands` for the separate shell policy,
  `monitoring.enabled`, `sync.enabled` plus `sync.intervalMs` for client settings
  sync, and `orchestration.enabled` for the local service
- Read API: `GET /panel/api/v1/status` (authenticated)
- Session: `GET|POST|DELETE /panel/api/v1/session`; setup: `POST /panel/api/v1/setup`
- Harness: `POST /panel/api/v1/harnesses` and `POST /panel/api/v1/harnesses/:id/test|activate`
- Mutations: `POST /panel/api/v1/features`, `POST /panel/api/v1/agent` (the
  historical master-stop route), `POST /panel/api/v1/shell`,
  `POST /panel/api/v1/monitoring`, `POST /panel/api/v1/sync`, and
  `POST /panel/api/v1/orchestration`
- Mutation guards: session, optional bridge source opt-in, `Host`, `Origin`, `Sec-Fetch-Site`,
  `content-type: application/json`, `x-clara-panel: 1`, 8 KB body limit,
  no unknown fields, no CORS headers
- Related: [panel.md](panel.md), [overview.md](../architecture/overview.md),
  [relay.md](../architecture/relay.md), [notifications.md](notifications.md)

</details>
