---
title: Panel access
description: Clients, devices, paired harnesses, and enrollment.
sidebar_position: 3
---

# Panel access

## Summary

The **Clients** and **Harness** views own identity and access in the panel. They
show live end-to-end encrypted browser sessions and the devices that own them,
the adapters enrolled with their own credentials, and the one-time codes that
enroll either. Every paired harness is a peer, so the panel lists and probes them
without picking a default. Revoking a device, deleting or forgetting a harness,
and editing a label all take effect from this surface.

## User flow

1. Open **Clients** to review live browser sessions and paired devices. The table
   shows transport, session, device, fingerprint, connected, last seen, idle
   time, and traffic counters. A one-time pairing session carries **Pairing** and
   is excluded from the active count; adapter sessions stay under **Harness**.
2. Choose **Pair Client** in the page header. Pick **Relay** or **Local** before
   creating a code; the helper text explains where that code works. **Create
   pairing link** then shows a locally rendered 288 px QR, **Open Link**, the
   expiry, and **Copy code** and **Copy link**. The raw code is not printed.
3. The dialog watches the five-second snapshot and changes from **Waiting to
   connect** to **Connected** when enrollment succeeds. Closing while waiting
   cancels the unused code; closing after it reports connected leaves the device
   in place. An expired code offers **Create new link**.
4. Review **Paired devices**. Each row shows the display name, short device id,
   fingerprint, added and last-seen times, and live session count. **Edit** sets
   an alias of up to 64 characters; the enrolled label stays as secondary text,
   and clearing the alias restores it. **Revoke** ends access; the revoked row
   stays listed and can then be deleted permanently.
5. Open **Harness** and choose **Pair Harness**. Pick the adapter, answer
   **Remote** or **Local**, then **This machine** or **Docker container** for a
   local target, and **Relay** or **Direct** for the route. Direct pairing needs
   a reachable WebSocket address; the panel suggests loopback, Docker bridge,
   LAN, and, in Clara Desktop, the container gateway.
6. The hub returns a one-time code, registry manifest, copy command, and
   `clara://adapter` link. Install actions are off until **Network → Adapter
   setup** is enabled. A browser-only user runs the command on the harness
   machine. Clara Desktop can install on **This computer**, an **SSH host**, or a
   local **Docker container**, streams the log, and can cancel; the hub host never
   receives SSH keys, Docker access, or a route to the harness machine.
7. The pairing card waits for the adapter, then reports **Connected**; the new
   adapter appears as **Paired · Offline**, and its credential session under
   **Connected adapters** turns it **Online**. That table shows transport,
   session, harness, kind, fingerprint, timestamps, and traffic counters.
   **Host resources** adds CPU, memory, adapter disk, a container badge, and the
   sample age.
8. **Paired harnesses** lists every adapter with label, kind, fingerprint,
   transport, version, status, last seen, and last test. **Test** probes it;
   **Delete** removes the connection but keeps identity and Clara metadata, and
   **Forget** purges both.

## Core business rules

1. **Device identity is logical, not hardware-bound.** The panel shows one row
   per stored device and one row per live connection. Multiple tabs share one
   device but appear as separate sessions; a device with more than one live
   session gets a warning badge.
2. **Pairing codes are one-time.** A browser uses a `clara1_` code from **Pair
   Client** or `clara pair`; an adapter uses a `clara-harness1_` code that only
   installs an adapter. The code is returned only by the authenticated request
   that creates it, expires, and cannot enroll twice.
3. **Adapters enroll like clients.** Adapter pairing uses the same fingerprint,
   expiry, E2EE handshake, replay guard, and revocation model. The credential is
   encrypted at rest and never returned in the snapshot; the table shows its
   fingerprint.
4. **Paired harnesses are peers.** There is no hub-wide default. The Harness
   tile reports how many paired harnesses are online, and context-free requests
   must name a harness.
5. **Delete and Forget differ.** **Delete** removes the connection but keeps the
   adapter identity and Clara session metadata. **Forget** purges both. **Test**
   probes the adapter's harness endpoint and records the last result.
6. **The hub issues installs, it does not run them.** The served panel returns
   the code, manifest, command, and link; only the bundled desktop panel can run
   an install through the app's loopback adapter host.
7. **Sessions are read-only.** The view fans out to every paired harness for its
   newest non-archived sessions, filters by search, harness, running, and
   archived, and adds no event stream or write.

## Edge cases

- **A code is cancelled or expires** — it cannot enroll a device. Create a new
  code; a cancelled token is removed and an expired one is pruned later.
- **The adapter is paired but offline** — the row says **Paired · Offline**, no
  probe runs, and harness-backed `/v1` calls return `harness_offline`.
- **Harness access is disabled** — the status says **Off**, no probe runs, and
  proxied requests fail with a disabled error while local and relay clients stay
  connected.
- **The adapter credential cannot be opened** — the connection stays listed but
  cannot authenticate. Re-pair the adapter; the rest of the hub keeps running.
- **An adapter is connected** — it has its own row under **Connected adapters**
  with its harness label, kind, id, and fingerprint, and never appears in the
  Clients table or its counts.
- **Host resources are stale or missing** — a transient probe keeps the last
  sample for up to thirty seconds. An adapter without the endpoint shows an
  empty state and is not polled again until it reconnects.
- **A session is archived or capped** — archived rows stay hidden until **Show
  archived**; a harness above the per-harness cap marks the view **capped**.

## Out of scope

- Non-superadmin users or per-device panel permissions
- Kicking a live client without revoking its device
- Per-client harness selection in the panel header
- Steering, cancelling, or archiving a session from **Sessions**

## Known gaps

- Harness online counts come from live adapter sessions and can briefly lag a
  restart or a credential change.
- The Sessions view reads up to 200 rows per harness, capped at 500, and does
  not paginate; active sessions missing from that page are looked up by id.

## Technical appendix

<details>
<summary>Routes, data, and references</summary>

- Browser pairing: `POST /panel/api/v1/devices/pairings` with
  `{ "localOnly": true }`; `DELETE /panel/api/v1/devices/pairings/:id` cancels
  an unused code. Devices: `DELETE /panel/api/v1/devices/:id` revokes;
  `PATCH` sets `{ "alias": "..." }` or `null`; `POST .../purge` deletes a
  revoked record.
- Harness pairing: `POST /panel/api/v1/harnesses/pairings` creates a code and
  `DELETE .../pairings/:id` cancels it. `POST /panel/api/v1/harnesses/:id/test`
  and `/forget` act on one adapter; `DELETE /panel/api/v1/harnesses/:id` deletes
  the connection.
- Install entry: `GET /panel/api/v1/install` returns registry manifests and
  availability; `POST /panel/api/v1/install` returns the offer without running
  it; `POST /panel/api/v1/install/settings` toggles it.
- Sessions: `GET /panel/api/v1/sessions` accepts `harnessID`, `running`,
  `archived`, `q`, and `limit` (1–500) and returns one status per paired harness.
- QR rendering uses `qrcode.react` at the lowest error-correction level; the
  dialog reads the same five-second status snapshot as the rest of the panel.
- Related: [index.md](index.md), [controls.md](controls.md),
  [network.md](network.md), [connection.md](../connection.md), and
  [harness-adapters.md](../harness-adapters.md)

</details>
