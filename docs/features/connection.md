# Connection

## Summary

Connects Clara to its paired harnesses through the Clara hub over an
end-to-end encrypted WebSocket, either through the Cloudflare relay or the local
listener. There is no direct HTTP mode. The browser tunnels to the hub even
before a harness adapter is online; harness-backed requests wait for the adapter
that owns the session or workspace. Only the adapter discovers the harness; the
hub never reads its service file or contacts it. Each browser enrolls its own
device key through a one-time code; there is no shared browser key.

## User flow

1. Start the hub and open its panel. Create the owner account and sign in. Until
   that account exists the hub starts only the loopback panel and no
   transports. Use **Harness → Pair Harness**, choose the adapter type, answer
   remote or local, and copy the one-time code and command. Clara Desktop can
   install it on this computer, an SSH host, or a local container; a browser
   user runs the command on the harness machine. A direct WebSocket URL under
   **Advanced** lets a remote or container target connect without a relay. For
   the included adapters, that is
   `clara start adapter --harness opencode --pair <code>` or
   `clara start adapter --harness claude --pair <code>`. The adapter
   discovers its harness, prompts for its URL/password if needed (OpenCode) or
   uses the machine's Claude Code login, enrolls, and installs the hub-facing
   adapter.
2. Open Clara. A branded splash shows while Clara checks a pairing link in the
   URL fragment or a stored device. A successful attempt opens the last project
   without showing the connect form.
3. If no device is stored, the connect screen offers the pairing form: **Scan QR
   code** and a paste field.
4. Scanning opens the rear camera and connects as soon as the QR shown in the
   panel's **Clients → Pair Client** dialog or printed by `clara-server pair`
   is recognized; a `clara1_…` code or `#pair=` link can still be pasted. A pairing link opened directly starts on the splash with a
   connecting message. Clara stores only non-secret metadata in `localStorage`
   and the non-extractable device key in IndexedDB.
5. Clara opens the WebSocket with the one-time enrollment token, completes the
   enrollment handshake, stores the device key, reconnects with the device id,
   and calls `/v1/info` through the tunnel to prove the hub is reachable.
6. On success Clara opens the last project, or the first project the server
   returns. It reads the paired-harness list separately; when no adapter is
   paired or every adapter is offline, the app stays connected and shows a
   retryable harness banner instead of failing the connect screen.
7. On failure the form explains whether the code, expiry, fingerprint, relay,
   authentication, or reachability failed. A failed pairing link returns to the
   pair form with the reason.
8. **Settings → Reconnect** re-proves the current transport without clearing the
   stored device. The sidebar health control offers the same action.
9. **Settings → Disconnect** forgets the device in this browser and returns here.
   Revoke it in the panel if the credential should stop working everywhere.

## Core business rules

1. Clara talks to one hub at a time. Connecting again replaces the
   client, clears cached queries when the target changes, and restarts the
   stream.
2. The transport never sends a harness password to the browser. The adapter
   adds harness authentication and is the only process that talks to its
   harness; the hub maps each typed `/v1` call to the harness that owns the
   session or workspace, and requires an explicit harness otherwise.
3. `VITE_CLARA_WS_URL` retargets relay-room pairings; a `local` pairing keeps the
   endpoint from its payload. The panel's local-only option or
   `clara-server pair --no-relay` produces a `local` pairing even when the hub
   has a relay configured.
4. A stored device is retried on boot before the pair form renders. Existing
   clients from before per-device credentials must re-pair.
5. The connect screen holds a splash until the boot attempt settles, but a
   12-second watchdog reveals the form if the probe wedges. Normal probe and
   handshake failures settle first and report their own reason.
6. The event stream is healthy only while chunks keep arriving. The hub sends
   a heartbeat every 15 seconds; 45 seconds of silence is treated as dead.
7. The hub keeps every paired connection in one table and never marks one as
   default. If none is paired, the tunnel can connect but harness-backed routes
   return `503` with `harness_unconfigured`; a named adapter that is offline
   returns `harness_offline`. The connection probe is `/v1/info`, not a harness
   endpoint, so these states render as a banner instead of a connection error.
   Pair or start an adapter in the panel
   to use projects and sessions.
8. Push notifications need the hub's E2EE transport; the control channel
   also carries push subscriptions.
9. The web transport queues HTTP requests above a small in-flight cap. Query
   bursts wait instead of hitting the hub's per-session ceiling, which is
   64 concurrent requests.
10. Each device key is revocable on its own. A revoked device is rejected on the
    next handshake or action.
11. The hub advertises its web, hub, and engine endpoints to harness adapters in
    `ready.agent` and `agent.status`; browser sessions never receive that block.
    An adapter keeps the report in its live state so `clara status` on an
    adapter-only machine can show where the services run without a second API
    credential or a local probe.

## Edge cases

- **401 from the relay** — the Worker rejects the WebSocket before upgrade; the
  hub token or the client's grant is wrong, expired, or rotated. Clara reports
  that the relay refused the connection and names the room URL.
- **Local-only code on HTTPS** — the transport reports that the pairing code is
  local-only instead of a bare socket close.
- **Fingerprint mismatch** — the enrollment reports a mismatch; request a fresh
  code.
- **Expired or used code** — the hub rejects enrollment; generate a new code.
- **Hub offline** — the client connects, receives `1013`, and reports that the
  hub is unreachable.
- **Device revoked** — the hub sends `revoked_device`, the client disconnects,
  and the panel shows the device as revoked until its record is deleted.
- **Harness not configured** — the hub connects and the app shows a harness
  banner instead of the connect screen. Open the panel and pair an adapter.
- **Harness paired but offline** — the banner reports `harness_offline` and
  offers Retry; the hub tunnel and settings stay usable.
- **Adapter cannot reach the harness** — `127.0.0.1` inside an adapter
  container is the adapter itself. Use the harness service name or an address
  reachable from the adapter host. In the Docker stack the adapter joins the
  `clara` network and reaches the hub at `ws://server:8788/ws`.
- **Adapter reconnect loop** — `clara status adapter` and the adapter log show
  the most recent relay close code. `4008` means the relay's frame or byte
  budget refused the socket; `4009` means one sealed frame exceeded 128 KiB. The
  adapter backs off and retries, and a persistent loop means the adapter is
  sending too much or a response was not split.
- **Adapter host shows no service endpoints** — the adapter predates endpoint
  advertisement or has not completed a handshake yet. Upgrade or start it; the
  CLI still shows the hub link and harness from the adapter's live state.
- **Stored device cannot connect** — Clara falls back to the pair form; it does
  not silently try another hub. Revoke the stale entry in the panel.
- **Pairing link fails** — the connecting splash gives way to the pair form,
  which shows the connection failure reason.
- **Camera denied, missing, or busy** — the scanner names the reason and keeps
  paste available. A plain `http://` page hides the scan action because browsers
  require HTTPS or localhost for the camera.
- **Non-Clara QR** — the scanner reports it and keeps looking instead of
  starting a connection.
- **Wedged boot probe** — the splash yields to the pair form after 12 seconds so
  the screen cannot hang forever.
- **Stalled stream** — the transport heartbeat aborts a half-open socket and
  reconnects with backoff.
- **Manual reconnect fails** — the current client and device credential are
  kept; the Settings card shows the error and the stream keeps retrying.
- **Provider failure** — a run that fails at the model provider is not a
  connection failure. The assistant message shows the error and the stream stays
  live.

## Out of scope

- Per-device relay targets; every device uses the hub's configured relay
- Multiple saved server profiles or switching without disconnecting
- OAuth or provider credential management
- A public HTTP proxy shipped with Clara

## Known gaps

- Reconnect re-proves the transport and restarts the stream; it is not a
  separate dry-run that leaves the connection untouched.
- The connect screen does not show the server's full URL list after success;
  Settings does.
- A relay device grant lasts thirty days and is refreshed on each connect. A
  device offline longer than that must pair again.
- A copied browser profile may still be able to use a non-extractable device key
  depending on the browser; passkey binding is not implemented.

## Technical appendix

<details>
<summary>Routes, data, and references</summary>

- Route: `/connect`
- Pairing payload: `{ v, wsUrl, room, enrollId, enrollToken, grant?, fingerprint, expiresAt }`;
  `grant` is required for a relay payload and absent for a local one
- Probe: `GET /v1/info` through the WebSocket transport, 8s timeout on connect,
  5s on reconnect; `/v1/harness/info` loads separately for the harness banner
- Boot gate: `ConnectionProvider` exposes `booting` and `bootSource`; the page
  renders a splash until boot settles, with a 12s watchdog
- Client factory: `createClient` in `apps/web/src/lib/client.ts`, WebSocket only
- Device storage: `apps/web/src/lib/device-store.ts` (IndexedDB, non-extractable
  `CryptoKey`)
- Pairing scanner: `apps/web/src/features/connect/use-qr-scanner.ts`; decoding
  and camera error copy in `apps/web/src/lib/qr-scan.ts`
- Relay transport: `apps/web/src/lib/transport/relay.ts` (also serves the local
  listener)
- Hub: `apps/hub/server/src/` (`config`, `agent`, `harness`, `local-server`,
  `relay-client`, `pairing`, `store/devices`); adapter daemon:
  `apps/adapters/opencode/`
- Harness setup: panel pairing → `harness_identities`, `harness_connections`,
  and `adapter_credentials` in `clara.db`; the adapter connects out over the
  WebSocket and speaks the Clara Harness Protocol. The hub never sees the
  harness password; the adapter keeps it in its own config.
- Local endpoint: the hub prefers its previous local port, then `8788`, and
  falls back to an ephemeral port when one is busy. The live endpoint is written
  to `runtime.json`; the CLI, MCP, hub shell, and desktop client read it. The
  desktop client refreshes a local `wsUrl` on boot and reconnect, so a port
  change does not require pairing again. Relay pairings carry the relay URL and
  are unaffected.
- Incomplete relay: a saved relay URL without the hub token never blocks
  startup. The hub runs local-only, the panel marks the relay as missing its
  token, and saving it in the Relay card starts the relay without a restart.
  Only explicit relay actions (relay pairing, Cloudflare deployment) reject an
  incomplete relay.
- Bundled panel: route `/hub` in `apps/web`/`apps/desktop`, package
  `@clara/panel`, bridge `/v1/hub-panel` on the E2EE session. The bridge reaches
  the panel listener at its loopback address; it adds no listener and publishes
  no port. A login over the bridge returns a session bearer token; the served
  page keeps `clara_panel_session` as an HttpOnly cookie. Both use the hub's
  superadmin session policy and are revoked with it.
- Bundled panel controls: `PanelCapabilitiesProvider` disables **Go offline**,
  the transport switch in use (local or relay), and relay target/room edits,
  because each would cut or retarget the connection carrying the panel. Harness, device,
  monitoring, sync, orchestration, and configuration controls stay available.
- Adapter installs from the bundled panel: the hub issues the one-time code,
  registry manifest, copy command, and `clara://adapter` link. Clara Desktop's
  adapter host (`apps/desktop/host`) turns an offer into a local, SSH, or Docker
  install through `packages/adapters/install`; the hub runs nothing.
- Docker stack: `clara start` starts the engine, hub, and web client
  together; `start hub`, `start web`, or `start engine` selects one
  target; `restart` recreates the selection.
- Server container: `clara start hub --docker`; panel and local
  WebSocket publish on host loopback, and adapters on the `clara` Docker network
  connect to `ws://server:8788/ws`.
  The maintenance snapshot records `local` vs `container` and recreates the
  container with stop/start; see [maintenance.md](maintenance.md).
- Web container: `clara start web --docker --build` serves the SPA on
  `127.0.0.1:8080`. Local pairing works from that loopback origin; a remote
  HTTPS page still needs the relay because pairing carries a `ws://` URL. The
  maintenance snapshot records the web client as `container` or `stopped`.
- Stream health: `onActivity` tracks every chunk, including the 15s heartbeat;
  the watchdog aborts after 45s of silence
- Related: [architecture overview](../architecture/overview.md),
  [relay](../architecture/relay.md), [E2EE](../architecture/e2ee.md),
  [pairing](pairing.md)

</details>
