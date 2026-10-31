# Connection

## Summary

Connects Clara to one OpenCode server, either through the Clara home agent over
an end-to-end encrypted WebSocket or directly over HTTP. The connect screen also
pairs new devices from a QR code and proves the connection before showing data.

## User flow

1. Open Clara. If a stored device exists, Clara reconnects automatically. A
   pairing link in the URL fragment is consumed before any connection attempt.
2. Otherwise the connect screen shows **Pair this device** and a direct
   **Connect directly** form.
3. Scan the QR printed by `clara-server pair`, or paste its `clara1_…` code.
   Clara stores the relay/local endpoint, room, client token, PSK, and
   fingerprint.
4. Clara opens the WebSocket, completes the E2EE handshake, verifies the
   fingerprint, and calls the OpenCode info endpoint through the tunnel.
5. On success Clara stores the pairing and opens the last project, or the first
   project the server returns.
6. On failure the screen explains whether the code, key fingerprint, relay,
   authentication, reachability, or CORS failed.
7. **Settings → Reconnect** re-proves the current transport without clearing
   credentials. The sidebar health control offers the same action.
8. **Settings → Disconnect** clears the stored device and returns here.
9. Direct mode keeps the URL/password form for an operator-managed OpenCode
   server or a local dev proxy.

## Core business rules

1. Clara talks to one home agent/server at a time. Connecting again replaces the
   client, clears cached queries when the target changes, and restarts the
   stream.
2. Relay/local mode never sends the OpenCode password to the browser. The agent
   adds basic auth and only proxies `/api/` paths on the configured origin.
3. Direct mode uses HTTP basic auth with the fixed `opencode` user. Credentials
   live in `sessionStorage` unless "remember" is checked.
4. `VITE_CLARA_WS_URL` selects the deployment endpoint. Pairing supplies the
   room, client token, and PSK; an empty variable falls back to direct HTTP.
5. A stored device is retried on boot before local service detection.
6. The event stream is healthy only while chunks keep arriving. The agent sends
   a heartbeat every 15 seconds; 45 seconds of silence is treated as dead.
7. The local proxy only finds a server registered in `service.json` by
   `opencode service start`. A foreground `opencode serve` must be connected
   manually with its URL, password, and a CORS entry for Clara's origin.

## Edge cases

- **401 from OpenCode** — direct mode reports authentication failure and keeps
  the URL.
- **401 from the relay** — the Worker rejects the WebSocket before upgrade; the
  pairing token is wrong or rotated.
- **Fingerprint mismatch** — the E2EE handshake closes with `4001`; re-pair.
- **Agent offline** — the client connects, receives `1013`, and reports that the
  home server is unreachable.
- **Server down or wrong port** — direct mode explains that the URL, CORS, or
  process may be wrong.
- **502 from the local proxy** — `service.json` points at a stopped or restarted
  service. Run `opencode service start`.
- **CORS rejection** — direct mode points at `opencode serve --cors <origin>`.
- **No local service** — the local card is hidden; pairing and manual connection
  still work.
- **Stale stored device** — Clara falls back to the connect screen with the
  previous target prefilled; it does not silently try another server.
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
- Client factory: `createClient` in `apps/web/src/lib/client.ts`
- Relay transport: `apps/web/src/lib/transport/relay.ts`
- Home agent: `apps/server/src/` (`config`, `agent`, `local-server`,
  `relay-client`, `pairing`)
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
