# Connection

## Summary

Connects a browser, installed PWA, or desktop client to one Clara hub over an
end-to-end encrypted WebSocket, through the hub's local listener or the
Cloudflare relay. Each device enrolls its own revocable key from a one-time
pairing link, so there is no shared browser credential and the harness password
never reaches the browser.

## User flow

1. On the hub, sign in to the panel and choose **Clients → Pair Client**, or run
   `clara pair` on the hub machine. Choose **Relay** or **Local** and create the
   link: the dialog shows a QR, **Open Link**, the expiry, and **Copy code** /
   **Copy link**, and reads **Waiting to connect** until a device enrolls.
2. Open Clara on the device. The connect screen offers **Scan QR code** and a
   paste field; a pairing link opened directly is consumed from its URL
   fragment behind a branded splash.
3. Clara validates the payload and expiry, checks that this browser can store a
   non-extractable key, and opens the socket with the one-time enrollment token
   plus, for a relay code, its enrollment grant.
4. The hub consumes the token, stores the device key encrypted, and returns the
   device id, fingerprint, and first device grant. Clara keeps the key in
   IndexedDB, reconnects with the device id, and probes `/v1/info` through the
   tunnel.
5. Compare the fingerprint Clara shows with the one in the panel's
   paired-devices table before trusting the enrollment.
6. On success Clara opens the last project, or the first the hub returns. With
   no paired adapter, or every adapter offline, the app stays connected and
   shows a retryable harness banner instead of failing the connect screen.
7. **Settings → Reconnect** re-proves the current transport without forgetting
   the device. **Settings → Disconnect** forgets it in this browser and returns
   to the connect screen.
8. Revoke a device in the panel, or run `clara pair --revoke <id>`;
   `clara pair --revoke-all` revokes every device and clears push
   subscriptions.

## Core business rules

1. Pairing is the only way to obtain a device credential. The link carries
   `{ v, wsUrl, room, enrollId, enrollToken, grant?, fingerprint, expiresAt }`
   in the URL fragment, so the Pages origin and Cloudflare never see it. The
   token and its grant expire after ten minutes and enroll exactly one device; a
   retry with the same device id is idempotent, and a second device reusing the
   token is rejected.
2. The browser generates the device key and stores it as a non-extractable
   `CryptoKey` in IndexedDB; the hub stores the same key encrypted with
   `secrets.key`. The fingerprint is a truncated SHA-256 of that key. There is
   no shared browser key, and the transport never carries the harness password:
   the adapter adds harness authentication.
3. Clara talks to one hub at a time. Connecting again replaces the client,
   clears cached queries when the target changes, and restarts the stream.
   `VITE_CLARA_WS_URL` retargets relay-room payloads only; a `local` pairing
   keeps the endpoint from its own payload.
4. Health is measured from traffic, not from the socket being open. The hub sends
   a heartbeat every 15 seconds and 45 seconds of silence is treated as dead, so
   the transport aborts the half-open socket and reconnects with backoff. The
   connect screen holds its splash until the boot attempt settles, but a
   12-second watchdog reveals the form. The web transport also queues requests
   above a small in-flight cap, so query bursts wait instead of hitting the
   hub's 64-request ceiling.
5. Each device is revocable on its own. A revoked device is rejected on its next
   handshake or action, its live sessions end, and its push subscriptions are
   removed; other devices keep working.

## Adapter pairing

Harness adapters use the same one-time code, fingerprint, expiry, E2EE handshake,
and revocation model, but a `clara-harness1_…` code installs an adapter and
cannot enroll a browser. See [harness adapters](harness-adapters.md) for install
paths, transport choices, and adapter failure modes.

## Edge cases

- **Expired or used code** — Clara rejects it before connecting or the hub
  refuses enrollment; create a fresh code in the panel.
- **Adapter code pasted** — the connect screen names it and points at
  **Clients → Pair Client** or `clara pair`; adapter codes only install an
  adapter.
- **Fingerprint mismatch** — the enrollment reports the mismatch; request a
  fresh code rather than accepting the device.
- **Hub unreachable** — a relay `401` means the grant is wrong, expired, or
  rotated, so retrying is pointless; a `1013` close means the room has no hub.
- **Local-only code on HTTPS** — the transport reports that the code is
  local-only instead of a bare socket close; create a relay code for that
  device.
- **Device revoked** — the hub sends `revoked_device`, the client disconnects,
  and the panel shows the device as revoked until its record is deleted.
- **Stored device cannot connect** — Clara falls back to the pair form rather
  than silently trying another hub; revoke the stale entry in the panel.
- **Harness not configured or offline** — the tunnel connects and the app shows
  a banner with `harness_unconfigured` or `harness_offline` and Retry; pair or
  start the adapter in the panel.
- **Camera unavailable** — a denied, missing, or busy camera is named in the
  dialog with retry and paste; a plain `http://` page hides scanning (browsers
  need HTTPS or localhost), and a non-Clara QR never starts a connection.
- **Throttled by the relay** — a `4008` or `4009` close is reported as throttling,
  not a lost socket: the transport waits five seconds, halves its send rate, and
  recovers after 45 stable seconds.

## Out of scope

- Per-device relay targets; every device uses the hub's configured relay
- Multiple saved hub profiles, or switching hubs without disconnecting
- OAuth or provider credential management
- A public HTTP proxy shipped with Clara
- Scanning a QR from a screenshot, camera torch or switching, or barcode formats
  other than QR
- Panel approval of new devices

## Known gaps

- A stolen but unused pairing link can enroll one device until it expires or is
  used. The panel shows the new device and can revoke it.
- A relay device grant lasts thirty days and is refreshed on each connect, so a
  device offline longer than that must pair again.
- The device id and grant id are visible to the relay, which can correlate a
  device's connections.
- A copied browser profile may still use a non-extractable key; there is no
  passkey binding.

## Technical appendix

<details>
<summary>Routes, data, and references</summary>

- Route `/connect`; client `apps/web/src/lib/client.ts` (WebSocket only) and
  `apps/web/src/lib/transport/relay.ts` (relay plus local listener).
- Panel: `POST /panel/api/v1/devices/pairings` with `{ "localOnly": true }`
  creates a link, code, and fingerprint; `DELETE /panel/api/v1/devices/pairings/:id`
  cancels one; `DELETE /panel/api/v1/devices/:id` revokes a device. Codes are
  returned only by the authenticated creation request, never in the snapshot.
- Pairing URL: `<webUrl>/#pair=<base64url(JSON)>`. Payload:
  `{ v, wsUrl, room, enrollId, enrollToken, grant?, fingerprint, expiresAt }`;
  `grant` is required for a relay payload and absent for a local one.
- Probe: `GET /v1/info` over the WebSocket transport, 8s on connect and 5s on
  reconnect; `/v1/harness/info` loads separately for the harness banner.
- Boot gate: `ConnectionProvider` exposes `booting` and `bootSource`; the page
  shows a splash until boot settles, with a 12s watchdog.
- Storage: IndexedDB `clara-devices` / `device` holds the non-extractable key;
  `localStorage` holds non-secret metadata only.
- Hub data: `devices` and `device_keys` (encrypted with `secrets.key`),
  `pairing_tokens` for unused codes, and per-device entries in
  `subscriptions.json`.
- Related: [harness adapters](harness-adapters.md), [hub service](hub-service.md),
  [panel](panel/index.md), [architecture overview](../architecture/overview.md),
  [relay](../architecture/relay.md), [E2EE](../architecture/e2ee.md)

</details>
