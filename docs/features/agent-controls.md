# Agent controls

## Summary

The home agent can be stopped, and its external connections switched on or
off, from the loopback panel without editing files or restarting the service.
The process, panel, and database stay available so the agent can always be
started again.

## User flow

1. Open the panel at `http://127.0.0.1:8790/` on the machine running the agent.
2. Each transport card carries its own switch at the top left: OpenCode
   connection, local transport, relay, and push notifications. The status chip
   sits beside the card title.
3. Toggle one feature. The panel posts the change, waits for the agent to apply
   it, then refreshes the snapshot. Turning the feature off collapses its card
   to the header and switch; turning it on restores the details.
4. Read the **Desired** and **Effective** values on the switch and on the
   matching transport card. A failed start shows an error instead of pretending
   the feature works.
5. Choose **Stop agent** at the bottom right of the **Agent** card and confirm.
   All external connections close, the E2EE sessions are reset, and the page
   shows the stopped banner.
6. While stopped, feature switches are disabled. Choose **Start agent** in the
   same place to restore every saved on/off choice, including features that were
   off before the stop.
7. Restart the process at any time; the saved choices and the stopped state are
   loaded before any transport starts.

## Core business rules

1. **Two layers.** _Desired_ is the saved user choice. _Effective_ is true only
   when the choice is on, the agent is not stopped, and the transport actually
   started. The panel always shows both.
2. **Stopping does not change preferences.** Master stop closes OpenCode access,
   the local listener, the relay socket, and the push monitor, but leaves the
   saved feature choices alone. Starting reapplies them.
3. **The panel outlives the agent's connections.** Master stop keeps the process,
   the loopback panel, and the database alive. It is not the systemd stop action
   and it does not exit the process.
4. **Failures are reported, not fatal.** If a port is busy, the relay is
   unavailable, or push keys are invalid, the desired value is still saved and
   the panel reports an error with `effective: false`. The process keeps running.
5. **Dependencies are visible.** Turning OpenCode off stops the push event
   monitor but leaves the local and relay transports connected. Push actions are
   gated separately.
6. **Cards follow their switch.** A disabled feature hides its details so the
   page stays compact; the header keeps the switch and status chip. The shell
   card uses the same collapse rule but stays amber until Apply saves the draft.

## Edge cases

- **Stopped at startup** — only the panel and database start. The log says the
  agent was stopped by an admin setting, and every transport stays off.
- **Feature change while stopped** — the panel disables the feature switches,
  the cards stay collapsed, and the API returns `409`; the saved choices cannot
  drift while the agent is off. The separate shell policy stays editable.
- **Local port busy** — the saved local setting stays on, the listener reports
  `effective: false`, and retrying after the port is free starts a fresh
  listener.
- **Relay not configured** — enabling it records the choice and reports an error;
  the relay card explains that a URL and both tokens are required.
- **Push unavailable** — a VAPID or subscription-file failure leaves the switch
  on but ineffective, with the startup error. Existing subscriptions are kept.
- **OpenCode down** — the OpenCode probe reports unreachable while the agent
  keeps running and the other transports stay up.
- **Panel port busy** — the panel logs `panel unavailable` and the agent keeps
  its other connections; restart the process after freeing the port.
- **Database cannot open** — startup fails with an error naming the database
  path; the agent does not silently fall back to defaults.

## Out of scope

- Stopping or restarting the systemd unit from the panel
- Editing `server.json`, the OpenCode URL, ports, rooms, or tokens from the panel
- Kicking clients or revoking a device
- Historical metrics or a persisted audit trail
- Remote access to the panel through the relay or Pages
- Sandboxing command execution; see [panel](panel.md) for the separate shell
  policy and its limits

## Known gaps

- Loopback is not a user boundary. Any process or browser extension on the
  machine can read and now also change the controls.
- A relay that is enabled but unreachable keeps retrying; the switch reads
  effective while the relay card shows reconnecting or offline.
- The panel has no authentication by design, so it must never be exposed beyond
  loopback.

## Technical appendix

<details>
<summary>Routes, data, and references</summary>

- Settings file: `CLARA_DB_PATH` or `<CLARA_CONFIG_DIR>/clara.db` (mode `0600`)
- Settings keys: `features.opencode`, `features.local`, `features.relay`,
  `features.push`, `agent.stopped`, plus `shell.mode` and `shell.commands` for
  the separate shell policy
- Read API: `GET /panel/api/v1/status`
- Mutations: `POST /panel/api/v1/features`, `POST /panel/api/v1/agent`, and
  `POST /panel/api/v1/shell`
- Mutation guards: loopback, `Host`, `Origin`, `Sec-Fetch-Site`,
  `content-type: application/json`, `x-clara-panel: 1`, 8 KB body limit,
  no unknown fields, no CORS headers
- Related: [panel.md](panel.md), [overview.md](../architecture/overview.md),
  [relay.md](../architecture/relay.md), [notifications.md](notifications.md)

</details>
