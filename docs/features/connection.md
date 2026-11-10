# Connection

## Summary

Connects Clara to one OpenCode server, either through the Clara home agent over
an end-to-end encrypted WebSocket or directly over HTTP. Before pairing, the
home agent's authenticated panel must contain an active OpenCode harness
connection; the server no longer discovers OpenCode's `service.json`. The
connect screen pairs new devices by scanning a QR code with the camera or
pasting its code, and proves the connection before showing data.

## User flow

1. Start the home agent and open its panel. Complete the one-time setup token,
   sign in, and save the OpenCode base URL and password in **Harness
   connections**. In a container, use the OpenCode service name
   (`http://opencode:4096`) or another address reachable from the `clara`
   network.
2. Open Clara. A branded splash shows while Clara checks a pairing link in the
   URL fragment, a stored device, or a local service. A successful attempt opens
   the last project without showing the connect forms.
3. If no connection is confirmed, the connect screen offers two controls:
   **Pair this device** and **Connect directly**. Choosing one swaps the form;
   only the active form is shown.
4. **Pair this device** offers **Scan QR code** and a paste field. Scanning
   opens the rear camera and connects as soon as the QR printed by
   `clara-server pair` is recognized; a `clara1_…` code or `#pair=` link can
   still be pasted. A pairing link opened directly starts on the splash with a
   connecting message. Clara stores the relay/local endpoint, room, client
   token, PSK, and fingerprint.
5. Clara opens the WebSocket, completes the E2EE handshake, verifies the
   fingerprint, and calls the OpenCode info endpoint through the tunnel.
6. On success Clara stores the pairing and opens the last project, or the first
   project the server returns.
7. On failure the active form explains whether the code, key fingerprint, relay,
   authentication, reachability, or CORS failed. A failed pairing link returns
   to the pair form with the reason.
8. The local-service card sits below the active form when a service is detected.
9. **Settings → Reconnect** re-proves the current transport without clearing
   credentials. The sidebar health control offers the same action.
10. **Settings → Disconnect** clears the stored device and returns here.
11. Direct mode keeps the URL/password form for an operator-managed OpenCode
    server or a local dev proxy.

## Core business rules

1. Clara talks to one home agent/server at a time. Connecting again replaces the
   client, clears cached queries when the target changes, and restarts the
   stream.
2. Relay/local mode never sends the OpenCode password to the browser. The agent
   adds basic auth and only proxies `/api/` paths on the configured origin.
3. Direct mode uses HTTP basic auth with the fixed `opencode` user. Credentials
   live in `sessionStorage` unless "remember" is checked.
4. `VITE_CLARA_WS_URL` retargets relay-room pairings; a `local` pairing keeps the
   endpoint from its payload. `clara-server pair --local` produces a `local`
   pairing even when the agent has a relay configured. Pairing supplies the room, client token, and PSK.
5. A stored device is retried on boot before local service detection.
6. The connect screen holds a splash until the boot attempt settles, but a
   12-second watchdog reveals the options if the probe wedges. Normal probe and
   handshake failures settle first and report their own reason.
7. Pairing and direct connection are separate modes in one chooser. Switching
   modes preserves the typed values; it does not start a connection.
8. The event stream is healthy only while chunks keep arriving. The agent sends
   a heartbeat every 15 seconds; 45 seconds of silence is treated as dead.
9. The Vite dev proxy still finds a server registered in `service.json` by
   `opencode service start`. That is a direct-mode development convenience, not
   the home agent's harness setup. A foreground `opencode serve` must be
   connected manually with its URL, password, and a CORS entry for Clara's
   origin.
10. The home agent resolves its active harness connection from SQLite. If none
    is configured, the tunnel can connect but `/api/info` returns `503` with
    `harness_unconfigured`; configure it in the panel first.
11. Push notifications need the home agent's E2EE transport; direct HTTP mode
    has no control channel and leaves push unavailable.

## Edge cases

- **401 from OpenCode** — direct mode reports authentication failure and keeps
  the URL.
- **401 from the relay** — the Worker rejects the WebSocket before upgrade; the
  pairing token is wrong or rotated. Clara reports that the relay refused the
  connection and names the room URL and client token.
- **Local-only code on HTTPS** — the transport reports that the pairing code is
  local-only instead of a bare socket close.
- **Fingerprint mismatch** — the E2EE handshake closes with `4001`; re-pair.
- **Agent offline** — the client connects, receives `1013`, and reports that the
  home server is unreachable.
- **Harness not configured** — the agent connects but the OpenCode probe fails
  with `harness_unconfigured`. Open the panel and save an active connection.
- **Harness reachable from the host but not the container** — `127.0.0.1` inside
  the server container is the Clara server. Use the OpenCode container service
  name or an address reachable from the `clara` network.
- **Server down or wrong port** — direct mode explains that the URL, CORS, or
  process may be wrong.
- **502 from the local proxy** — `service.json` points at a stopped or restarted
  service. Run `opencode service start`.
- **CORS rejection** — direct mode points at `opencode serve --cors <origin>`.
- **No local service** — the local card is hidden; pairing and manual connection
  still work.
- **Stale stored device** — Clara falls back to the connect screen with the
  previous target prefilled; it does not silently try another server.
- **Pairing link fails** — the connecting splash gives way to the pair form,
  which shows the connection failure reason.
- **Camera denied, missing, or busy** — the scanner names the reason and keeps
  paste available. A plain `http://` page hides the scan action because browsers
  require HTTPS or localhost for the camera.
- **Non-Clara QR** — the scanner reports it and keeps looking instead of
  starting a connection.
- **Wedged boot probe** — the splash yields to the connect options after 12
  seconds so the screen cannot hang forever.
- **Local detection timeout** — the probe gives up after 2.5 seconds.
- **Password contains non-ASCII characters** — direct auth encodes UTF-8 before
  base64.
- **Stalled stream** — the transport heartbeat aborts a half-open socket and
  reconnects with backoff.
- **Manual reconnect fails** — the current client and credentials are kept; the
  Settings card shows the error and the stream keeps retrying.
- **Local service restarts** — the dev/preview proxies read `service.json` per
  request, so a new port and password are picked up without a Vite restart.
- **Provider failure** — a run that fails at the model provider is not a
  connection failure. The assistant message shows the error and the stream stays
  live.

## Out of scope

- Pairing expiration or per-device keys
- Multiple saved server profiles or switching without disconnecting
- OAuth or provider credential management
- A public HTTP proxy shipped with Clara

## Known gaps

- Reconnect re-proves the transport and restarts the stream; it is not a
  separate dry-run that leaves the connection untouched.
- The connect screen does not show the server's full URL list after success;
  Settings does.
- A relay pairing code can be reused until the PSK is rotated.

## Technical appendix

<details>
<summary>Routes, data, and references</summary>

- Route: `/connect`
- Pairing payload: `{ v, wsUrl, room, clientToken, psk, fingerprint }`
- Probe: `GET /api/info` through the selected transport, 8s timeout on connect,
  5s on reconnect
- Boot gate: `ConnectionProvider` exposes `booting` and `bootSource`; the page
  renders a splash until boot settles, with a 12s watchdog
- Client factory: `createClient` in `apps/web/src/lib/client.ts`
- Pairing scanner: `apps/web/src/features/connect/use-qr-scanner.ts`; decoding
  and camera error copy in `apps/web/src/lib/qr-scan.ts`
- Relay transport: `apps/web/src/lib/transport/relay.ts`
- Home agent: `apps/server/src/` (`config`, `agent`, `harness`, `local-server`,
  `relay-client`, `pairing`)
- Harness setup: panel → `harness_connections` in `clara.db`; the active
  OpenCode adapter adds basic auth and proxies `/api/*`
- Server container: `pnpm clara server start --docker`; panel and local
  WebSocket publish on host loopback, harness URLs use the `clara` Docker network.
  The maintenance snapshot records `local` vs `container` and recreates the
  container with stop/start; see [maintenance.md](maintenance.md).
- Stream health: `onActivity` tracks every chunk, including the 15s heartbeat;
  the watchdog aborts after 45s of silence
- Storage keys: `clara.connection.local`, `clara.connection.session`
- Dev proxy: a Vite middleware reads
  `${XDG_STATE_HOME:-~/.local/state}/opencode/service.json` on each request and
  forwards `/oc/*` with the basic-auth header. It runs in `vite` and
  `vite preview`.
- Related: [architecture overview](../architecture/overview.md),
  [relay](../architecture/relay.md), [E2EE](../architecture/e2ee.md),
  [pairing](pairing.md)

</details>
