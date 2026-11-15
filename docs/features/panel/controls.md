---
title: Panel controls
description: Switches, offline mode, orchestration, sync cadence, and restarts.
sidebar_position: 2
---

# Panel controls

## Summary

The hub keeps its process, panel, and database alive while an admin switches its
external connections on or off. The panel also starts and stops the local
orchestration service and owns the global gate and check cadence for client
settings sync. Each control saves immediately, reports desired and effective
state, and survives a hub restart.

## User flow

1. Open **Network**. Local transport, relay, and push each carry a switch at the
   top right of their card. The **Harness** header shows only its status chip,
   because multiple harnesses are supported and the legacy harness gate has no
   switch.
2. Toggle a feature. The panel posts the change, waits for the hub to apply it,
   then refreshes the snapshot. A feature that is off hides its details and its
   card cannot expand; turning it on makes the header expandable again.
3. Read **Desired** and **Effective** on the switch and its card. Desired is the
   saved choice; effective also requires connections to be on and the transport
   to have started. A failed start shows an error instead of claiming success.
4. In **Settings → Client sync**, turn settings sync on or off and choose the
   cadence at which paired clients check for changes. Turning it off hides the
   web Sync tab and rejects sync requests, but keeps the stored namespace and
   each device's category choices.
5. Choose **Go offline** at the far right of the **Overview** header and confirm.
   External connections close, E2EE sessions reset, the Hub tile reads
   **Connections inactive**, and an offline banner explains that the panel is
   still available. Feature switches are disabled while connections are off.
6. Choose **Go online** in the same place to restore every saved on/off choice,
   including features that were off before the stop. Monitoring, client-sync,
   and orchestration controls stay editable because they start no Clara
   transport.
7. Use the **Orchestration** switch in **Settings**. Turning it on starts a
   detached local instance and waits for `/health`; turning it off stops only a
   local instance started from this data directory. Container and external
   instances are detected, labelled, and left under their own management.
8. Restart the hub at any time. Saved choices and the stopped-connections
   setting load before any transport starts. Starting with connections off
   brings up only the panel and database.
9. Cards are accordions. The cards that form a view's body start expanded; the
   Traffic card expands only while monitoring is on. Click a header to collapse
   or reopen it.

## Core business rules

1. **Two layers.** _Desired_ is the saved choice. _Effective_ is true only when
   the choice is on, connections are not stopped, and the transport actually
   started. The panel always shows both.
2. **Going offline does not change preferences.** It closes harness access, the
   local listener, the relay socket, and the push monitor but leaves every saved
   feature choice intact. Going online reapplies those choices.
3. **The panel outlives the connections.** Go offline keeps the process, loopback
   panel, and database alive. It is not the systemd stop action and never exits
   the process.
4. **Failures are reported, not fatal.** A busy port, unavailable relay, or
   invalid push key saves the desired value and shows an error with effective
   false. The rest of the hub keeps running.
5. **Dependencies are visible.** Turning off the legacy harness gate stops the
   push event monitor but leaves the local and relay transports connected. Push
   actions are gated separately.
6. **Cards follow their feature.** A disabled feature keeps its switch and status
   chip but hides its details and cannot expand. The client-sync interval stays
   editable while the global gate is off, so the cadence can be prepared first.
7. **Choices are durable.** Feature choices, the stopped flag, monitoring, sync,
   orchestration, and adapter setup live in the hub database and load before any
   transport starts.
8. **Sync is global with immediate local pushes.** One gate and one interval
   apply to every paired client and every new pairing. A local edit still pushes
   immediately; clients pull only when the server revision changes.

## Edge cases

- **Started with connections off** — only the panel and database start. The log
  names the admin setting, and every transport stays off.
- **Feature change while stopped** — the switches are disabled and the API
  returns `409`; saved choices cannot drift. Monitoring, sync, and orchestration
  stay editable.
- **Local port busy** — the listener binds an ephemeral port and publishes it;
  existing local clients may need a new pairing, while relay clients are
  unaffected.
- **Relay not configured** — enabling it records the choice and reports an error;
  the relay card explains that a URL and hub token are required.
- **Push unavailable** — a VAPID or subscription-file failure leaves the switch
  on but ineffective, with the startup error. Existing subscriptions are kept.
- **Harness down** — the harness probe reports unreachable while the hub and the
  other transports stay up.
- **Panel or database failure** — a busy panel port falls back to an ephemeral
  one and the hub keeps its connections. A database that cannot open fails
  startup with an error naming its path; the hub does not fall back to defaults.
- **Orchestration change fails** — the error stays on the card, a failed local
  start does not stop the rest of the hub, and an externally managed instance
  cannot be stopped from the panel.

## Out of scope

- Stopping or restarting the systemd unit from the panel
- Editing ports, the harness URL, or arbitrary `server.json` values
- Kicking clients or revoking a device
- Historical metrics or a persisted audit trail
- Remote access to the panel through the relay or Pages
- Sandboxing command execution

## Known gaps

- Authentication is not host isolation. Any process with the panel cookie or the
  database and secret key can still change the controls.
- A relay that is enabled but unreachable keeps retrying; the switch can read
  effective while the relay card shows reconnecting or offline.
- The `Host`/`Origin` guard still expects a loopback origin, so direct LAN access
  is not a supported panel path; use an SSH tunnel.

## Technical appendix

<details>
<summary>Routes, data, and references</summary>

- Settings file: `CLARA_DB_PATH` or `<CLARA_DATA_DIR>/clara.db` (mode `0600`)
- Keys: `features.opencode` (the historical harness key), `features.local`,
  `features.relay`, `features.push`, `agent.stopped` (the historical
  stopped-connections key), `monitoring.enabled`, `sync.enabled` plus
  `sync.intervalMs`, and `orchestration.enabled`
- Read: `GET /panel/api/v1/status` (authenticated)
- Mutations: `POST /panel/api/v1/features`, `/agent` (`{ "stopped": true }`),
  `/monitoring`, `/sync`, and `/orchestration`
- Guards: session, optional bridge source opt-in, `Host`, `Origin`,
  `Sec-Fetch-Site`, `content-type: application/json`, `x-clara-panel: 1`, an
  8 KB body limit, no unknown fields, and no CORS headers
- Related: [index.md](index.md), [access.md](access.md),
  [network.md](network.md), [hub-service.md](../hub-service.md), and
  [overview.md](../../architecture/overview.md)

</details>
