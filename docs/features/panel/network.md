---
title: Panel network
description: Local access, relay, push, traffic, and storage health.
sidebar_position: 4
---

# Panel network

## Summary

The **Network** view configures how clients and adapters reach the hub and stay
in step. It owns the local listener and direct-access mode, the relay target and
generated room, the optional Cloudflare deployment, Web Push, client settings
sync, local orchestration, and adapter setup.

## User flow

1. In **Network**, the **Local transport** switch controls the WebSocket browsers
   and adapters pair with. The card shows the URL, host and port, desired and
   effective state, socket connections, and E2EE sessions.
2. **Listen on** chooses **This machine only**, **This machine and local Docker
   containers**, **All interfaces**, or **Custom address**. Save direct access to
   rebind only that listener; the card lists the resulting loopback, Docker, and
   LAN URLs. A wildcard mode warns that it exposes the WebSocket and API.
3. The **Relay** switch enables outbound remote access. Its editor saves the URL
   and hub token; the token is at least 32 characters with no spaces or commas,
   is encrypted, and is never shown again. The room is generated on first save
   and can only be regenerated, with confirmation, because that invalidates every
   pairing tied to it. **Clear panel relay** removes panel values.
4. A build with `ENABLE_CLOUDFLARE_DEPLOYMENT=true` adds **Deploy relay to
   Cloudflare**. Paste a Workers-scoped token, choose the account, and optionally
   attach a custom hostname in one of its zones. Clara uploads the Worker, creates
   the Durable Object namespace, sets the hub token, enables and health-checks the
   `workers.dev` host, and connects the relay without a restart.
5. With a custom hostname, Cloudflare issues its certificate first. The relay
   stays on `workers.dev` until the custom host answers, then Clara disables the
   `workers.dev` host. Existing devices must pair again for a v4 grant. **Deploy
   again** repeats the deploy, and **Forget token** removes the Cloudflare token.
6. In **Settings → Effective configuration**, edit the **Web URL** used by pair
   links and the **VAPID contact** used by push. A source tag shows environment,
   file, or default; an environment value locks the field. **Save** stores the
   value and **Use default** clears the file value.
7. The **Push** card shows the saved choice, effective state, subscriptions,
   failing deliveries, VAPID key, and storage. **Retry storage** retries a failed
   read; **Reset subscriptions** deletes every subscription after confirmation.
   Push endpoints are never shown.
8. **Client sync** turns settings sharing on or off and sets the cadence at which
   paired clients check for changes. A local edit still pushes immediately, and
   clients pull only when the server revision changes.
9. **Orchestration** starts or stops a local service and reports local, Docker,
   external, or stopped state. External instances stay under their own management.
10. **Adapter setup** sets the registry URL and allows install actions. The hub
    reads the manifest and never runs the adapter; **Check registry** re-reads it.
11. **Traffic** reports minute rates, two sparklines, totals, the
    local-versus-relay split, the peak minute, and errors. An amber **Spike**
    badge compares the last minute with the previous half hour.
12. The **Traffic** switch stops recording, discards counters, and drops the
    client table's traffic columns. Turning it on starts a fresh warm-up window
    and works while offline.
13. **Activity** lists storage files with health, readable and writable state,
    mode, bytes, schema, and sync counts; it never shows file contents.

## Core business rules

1. **Direct access rebinds one listener.** The modes are loopback, Docker
   (loopback plus bridge addresses), LAN (all interfaces), and custom. The value
   lives in `server.json`, `CLARA_LOCAL_ACCESS` overrides it, and a change
   rebinds only the local listener; the panel keeps its own port. Direct access
   exposes the WebSocket and API; it is not authentication.
2. **The hub owns the relay room.** Rooms are generated and can only be
   regenerated, never typed. Changing the room or hub token requires devices to
   pair again. Environment values win field by field, and the token is sealed in
   `relay-credentials.json` and never returned.
3. **Cloudflare deployment is an operator action.** The build flag adds the
   routes and UI; the deploy uses a Workers-scoped token, reuses the current
   generated room and hub token, and keeps preview and version URLs off by
   default. The `workers.dev` host goes off only after the custom host answers.
4. **Push separates the key from storage.** The VAPID contact and key can be
   valid while the subscription file is unreadable. Existing subscriptions are
   kept until an explicit reset, which deletes all of them.
5. **Traffic is advisory and in memory.** The meter counts frame sizes,
   decrypted request actions, and failures the hub already detects; it never
   reads or stores payloads. Counters live in a sixty-minute ring and reset on
   restart, a monitoring toggle, or a new window. Nothing is throttled or
   persisted.
6. **Storage health is metadata.** The panel reports existence, mode, size,
   schema, and permissions, never contents. Errors outrank warnings.

## Edge cases

- **Local transport is off** — the card says off and the listener closes its
  clients with a clear reason. Turning it on starts a fresh listener.
- **The local port is busy** — the hub binds an ephemeral port and publishes it.
  Existing local clients may need a new pairing; relay clients are unaffected.
- **Relay is not configured** — the card explains local-only mode and opens the
  editor. Saving a URL and token generates a room and connects without a restart.
- **The relay room is regenerated** — every code and signed grant tied to the old
  room becomes invalid, so devices must pair again after the confirmation.
- **Relay settings come from the environment** — each supplied field is read-only
  and wins over the panel. Remove the variable and restart the hub to edit it.
- **Push storage is unavailable** — the card keeps the VAPID key configured,
  marks storage unavailable, and offers **Retry storage** and **Reset
  subscriptions**.
- **A storage entry is unhealthy** — the header shows an error badge when any
  entry failed, otherwise a warning for read-only files, broad permissions, or
  missing required files; the tooltip counts each state.
- **Monitoring is switched off mid-stream** — counters stop where they are and
  the window is discarded; the stream itself keeps flowing.

## Out of scope

- Editing the relay room as free text
- Deleting the Worker or attaching a hostname in a zone the token cannot manage
- Per-device relay targets; every device follows the hub's relay
- Throttling, blocking, or alerting from the traffic meter

## Known gaps

- Traffic is measured at the hub, so connections the relay rejects before they
  reach it, and Cloudflare-level bandwidth, appear only in Cloudflare analytics.
- A relay that is enabled but unreachable keeps retrying; the switch can read
  effective while the card shows reconnecting or offline.
- Storage permissions are reported but never repaired from the panel.

## Technical appendix

<details>
<summary>Routes, data, and references</summary>

- Local transport appears in `GET /panel/api/v1/status`; direct access is saved
  with `POST /panel/api/v1/config` using `localAccess` and `localBindHost`.
- Relay target: `POST /panel/api/v1/relay` takes `url` and `agentToken`; omit the
  token to keep it, and `room` is rejected. `POST /panel/api/v1/relay/room`
  regenerates; `DELETE /panel/api/v1/relay` clears panel values.
- Cloudflare routes live under `/panel/api/v1/relay/cloudflare/`; a build without
  the flag omits the UI, routes, API code, and Worker artifact.
- Push: `POST /panel/api/v1/push` reloads or resets storage. VAPID contact and
  Web URL use `POST /panel/api/v1/config` with `vapidSubject` or
  `pairingBaseUrl`; `null` restores the default.
- Monitoring: `POST /panel/api/v1/monitoring` with `{ "enabled": false }`.
- Environment: `CLARA_LOCAL_ACCESS`, `CLARA_RELAY_URL`, `CLARA_RELAY_ROOM`,
  `CLARA_AGENT_TOKEN`, `CLARA_PAIRING_BASE_URL`, and `CLARA_VAPID_SUBJECT`.
- Settings files: `server.json` (Web URL and relay URL/room), `vapid.json`
  (VAPID contact), and encrypted `relay-credentials.json` (relay token).
- Related: [index.md](index.md), [controls.md](controls.md),
  [access.md](access.md), [hub-service.md](../hub-service.md),
  [relay.md](../../architecture/relay.md), and
  [overview.md](../../architecture/overview.md)

</details>
