# Agent panel

## Summary

An authenticated control panel served by the Clara home agent. It uses the
Clara Lab workbench layout: a title bar, an activity rail with tabbed views, and
a status bar. It shows the
agent's live state, transports, connected clients, active harness probe, push
health, configuration sources, database health, storage files, and a live
traffic meter without exposing secrets. Sensitive values start masked behind a
header peek control so the panel can be screenshared safely. It is also the
one-time setup surface for the coding-agent connection: the superadmin signs in,
chooses a password, and saves the OpenCode base URL and credentials. The same
surface edits the Web URL used by pairing links and the VAPID contact used by
Web Push, switches external connections on and off, starts and stops the local
orchestration service, stops the agent without stopping the process, decides
which shell commands a Clara client may relay to OpenCode, turns traffic
monitoring on or off, and gates or paces client settings sync.

## User flow

1. Start the agent after `pnpm build` with `pnpm clara server start --local`, or
   `pnpm clara server start` for the container, then run
   `pnpm clara server panel`. The open command only opens a panel that is
   already being served; the start command prints the panel URL
   (`http://127.0.0.1:8790/` by default).
2. The command opens the panel. First run shows setup: read the one-time token
   from `admin-setup.txt` in the config directory, or run
   `pnpm clara server setup-token` (it targets the running deployment
   automatically), then choose the superadmin password. Later visits show the
   sign-in form. After a host reset, the sign-in form shows a reset link while
   the token is valid.
3. After signing in, add the OpenCode harness connection: label, base URL, auth
   type, username, and password. Use **Test** before saving when possible. In a
   container, the URL must be reachable from the `clara` network, for example
   `http://opencode:4096`; `127.0.0.1` means the Clara server itself.
4. The panel opens on **Overview** with the Agent and Orchestration cards, a
   health strip for Harness, Local, Relay, Push, and Orchestration, the five most
   recent events, and a storage summary. A **Needs attention** banner names every
   degraded surface; health tiles jump to their tab. Status chips sit beside each
   card title, including a storage health summary that turns amber for warnings
   and red for errors. Sensitive values start masked: device ids and fingerprints,
   config and storage paths, local WebSocket endpoint, relay URL and room,
   connection session ids, and WebSocket URLs in activity or errors.
5. Move between views from the activity rail: **Home** (Overview), **Harness**,
   **Network** (Connections), **Clients**, **Traffic**, and **Activity**, with
   **Settings** pinned at the bottom. The rail shows live client and event counts
   and amber or red dots for trouble. Views are hash links (`#traffic`,
   `#clients`), keep their scroll position while you switch, and survive a
   reload. Cards open by default inside their view; click a header to collapse
   it. Cards with a feature switch can only be expanded while that feature is
   enabled.
6. The title bar shows the agent config path, the connection badge, the last
   update, version, the peek control, **Refresh**, and **Sign out**. The status
   bar along the bottom summarizes the agent, harness, local, relay, push,
   orchestration, and client state; each item opens the matching view.
7. In **Harness**, add the OpenCode connection: label, base URL, auth type,
   username, and password. Use **Test** before saving when possible, then
   **Activate** it. In a container, the URL must be reachable from the `clara`
   network, for example `http://opencode:4096`; `127.0.0.1` means the Clara
   server itself. The adjacent card shows the active harness URL, version,
   latency, secret state, and its on/off switch.
8. In **Connections**, toggle local transport, relay, or push from the switch at
   the top right of its card. The choice is saved immediately. An enabled switch
   is green while the agent runs and red while it is stopped; a disabled switch
   keeps its neutral track in both cases. Turning a feature off hides its
   details; turning it on makes the header expandable.
9. In **Settings**, edit **Web URL** or **VAPID contact** and choose **Save**;
   **Use default** clears the file value. The source tag shows environment,
   `server.json`/`vapid.json`, or default, and an environment value locks the
   field.
10. In **Settings**, use the **Shell commands** switch to enable or block all
    command requests. Enabling makes the header expandable; open it to edit
    **Filter commands**, optionally turn on **Allow Git history**, then choose
    **Apply** at the bottom right. **Discard** sits to its left. The switch stays
    amber until Apply succeeds, then turns green. Turning it off blocks every
    command immediately. Empty filters mean every command is allowed, and the
    card warns about it.
11. In **Settings**, turn client sync on or off for every paired client, and
    choose the interval at which those clients check for changes. Turning it off
    hides the web Sync tab and rejects sync requests; the stored namespace and
    each device's category choices remain. The interval defaults to 30 seconds.
12. To take every external connection offline, choose **Stop agent** at the top
    right of the Agent card on Overview and confirm. The page keeps polling; the
    banner explains that the panel is still available.
13. Choose **Start agent** to restore the saved choices. Feature switches are
    disabled until the agent is started again and show red while they are
    stopped, so the stopped state is readable from the switch colors alone. The
    shell policy stays editable because it only applies while connections are
    up.
14. In **Clients**, review the connected-client table and paired devices. A
    one-time pairing session appears with a **Pairing** badge and no device until
    enrollment finishes; it is excluded from the active count and the local E2EE
    session count. Each paired session row shows the device's label, short device
    id, and fingerprint so devices that share a label stay distinguishable.
    Status badges call out degraded OpenCode, relay, push, permissions, or
    missing files.
15. In **Traffic**, read the last minute's in and out rates, the request and
    error rates, the two sparklines for the last hour, and the totals since the
    window started. The card shows the local-versus-relay split, a peak minute,
    and the error breakdown. An amber **Spike** badge means the last complete
    minute was at least three times the previous half hour and above a floor; it
    is a hint, not a verdict.
16. Use the switch at the top left of **Traffic** to stop recording. The card
    collapses to its header, the counters are discarded, and the client table
    drops its traffic columns. Turning it back on starts a fresh window with a
    one-minute warm-up. The switch stays usable while the agent is stopped.
17. In **Activity**, read the in-memory events and the storage list. The storage
    header summarizes the most severe entry and its count, and the overview links
    here for the full list.
18. Use **Orchestration** on Overview to start or stop the local orchestration
    service. Turning it on starts a detached local instance when nothing is
    answering and waits for `/health`; turning it off stops only the local
    instance started from this data directory. A Docker or external instance is
    detected and labelled, and the switch is disabled because the panel does not
    own it. When the service is reachable, Clara groups worker sessions in
    **Workers** and keeps their session alerts quiet.
19. Leave the page open. It refreshes every five seconds while visible and
    pauses when the tab is hidden. Use **Refresh** for an immediate check.

## Core business rules

1. **Authenticated, and loopback by default.** The panel listens on
   `127.0.0.1:8790` by default. A container binds `0.0.0.0` inside its own
   network and publishes only on host loopback. Every API request except
   `/health`, the session endpoints, setup, and static assets requires a
   superadmin session. `CLARA_PANEL_BIND_HOST` and `CLARA_PANEL_ALLOW_REMOTE` are
   explicit exposure controls. The `Host`/`Origin` guard still expects a
   loopback origin, so remote access uses an SSH tunnel rather than direct LAN
   access. It is never served through the relay or Pages.
2. **First run is a one-time token, not a default password.** With no admin,
   the server writes `admin-setup.txt` (mode `0600`) in the config directory.
   The setup form exchanges that token for a username and a scrypt-hashed
   password. A lost password is reset only by the host-side
   `clara-server admin reset`, which writes a fresh token and revokes sessions.
   There is no network password-reset endpoint.
3. **Reads and writes require a session.** `GET` and `HEAD` serve the snapshot
   and assets after login. `POST` is accepted at the feature, agent, shell,
   monitoring, sync, orchestration, config, harness, password, and device-purge
   routes; `DELETE` revokes a device and removes a harness or the session.
   Unknown mutating methods return `405`.
4. **Secrets stay out.** The snapshot is built from an explicit allowlist. The
   device keys, enrollment codes, harness password, relay tokens, push
   endpoints, sync values, and file contents are never returned. Device keys and
   unused enrollment tokens are encrypted at rest in SQLite with a key outside
   the database. Device fingerprints, secret-configured flags, room id, and
   effective config values are included and start masked in the panel.
5. **Mutations are browser-hard to forge.** Besides authentication, the
   `Host`, `Origin`, and `Sec-Fetch-Site` checks, writes require
   `x-clara-panel: 1`; a write with a JSON body also requires
   `content-type: application/json`. Mutations reject unknown fields and cap the
   body at 8 KB. The custom header forces a CORS preflight for cross-origin
   pages, which the server rejects. No CORS headers are sent. Login and setup
   are rate-limited per source and username.
6. **Settings are durable.** Feature choices, the stopped flag, the shell
   policy, the monitoring choice, the orchestration switch, the client-sync
   gate and interval, the panel users, and harness connections live in the
   agent's SQLite database and are loaded before any transport starts. The panel
   can fail without stopping the agent; a busy panel port only loses the panel.
   The Web URL lives in `server.json` and the VAPID contact in `vapid.json`; the
   panel writes both, the environment overrides either, and the VAPID contact is
   applied to the live push service.
7. **The shell policy is read per request.** The agent consults it before
   forwarding a command request, so Apply takes effect on the next command
   without a restart. `off` refuses them all. `allowlist` with an empty filter
   list allows every command, but still requires a location and refuses a
   working directory outside it. A non-empty list admits a request only when a
   saved entry is a literal argv prefix of it. Entries cannot contain shell
   syntax, and interpreters such as `sh`, `env`, or `python` cannot be saved.
8. **This is a guardrail, not a sandbox.** The policy governs command requests
   relayed by this agent. It does not restrict the rest of the OpenCode API: file
   writes, prompts that let an agent run tools, and plugin RPC can still affect
   the host. See [git](git.md) for
   the full caveat.
9. **Traffic monitoring is advisory and in memory.** The meter counts frame
   sizes, decrypted request actions, and the failures the agent already detects;
   it never reads or stores payloads. Counters live in a sixty-minute ring of
   one-minute buckets and reset on restart or when monitoring is switched off.
   Nothing is throttled, blocked, or persisted, and the per-client counters are
   hidden while monitoring is off.
10. **Peek is presentation-only.** The eye button masks device ids and
    fingerprints, config and storage paths, local WebSocket endpoint, relay URL
    and room, connection session ids, and WebSocket URLs in activity messages
    and error notices. It does not redact the JSON snapshot, change any control,
    or reach the server: the agent's allowlist remains the security boundary.
    The choice lives in `sessionStorage` for the tab, so a reload keeps it and a
    new tab starts masked.

## Edge cases

- **No harness is configured** — the harness card starts open with the setup
  form. `/api/*` requests through the agent return `503 harness_unconfigured`
  until a connection is saved and activated. The web app should be configured
  after this step.
- **The harness is down or rejects the password** — the harness card shows
  unreachable, timed out, or auth rejected, with the last check time. The agent
  keeps running.
- **The harness is turned off** — the card says disabled, the probe is not run,
  and proxied requests fail with a disabled error. Local and relay clients stay
  connected.
- **The harness secret key is lost** — the connection stays listed but is
  marked unconfigured. Re-enter the password; the rest of the agent keeps
  running.
- **The setup token is missing** — the panel explains how to run
  `pnpm clara server setup-token` or `clara-server admin reset`. It does not
  fall back to a default password.
- **The setup token is wrong or expired** — setup returns a generic invalid-token
  error and keeps the form available. Run the host reset command to issue a new
  token.
- **The superadmin password is lost** — run `pnpm clara server admin reset`. It
  targets the running deployment automatically and prints which one it chose,
  writes a new one-time token, and revokes every panel session. While that token
  is valid, the sign-in screen shows **Lost your password? Use a reset token**;
  the form takes the token and a new password and keeps the existing username.
  The link disappears when the token is used or expires. There is no HTTP reset
  route.
- **A local install and the Docker stack both have state** — the command refuses
  to guess and exits after printing the reason. Pass `--docker` for the
  `clara-server` container or `--local` for the local install.
- **The session expires** — the next poll returns `401`, the dashboard is
  replaced by the sign-in screen, and no stale data is shown.
- **The panel is reached through the Docker bridge** — `CLARA_PANEL_ALLOW_REMOTE`
  skips only the socket-address check; authentication, `Host`, `Origin`, and
  fetch-metadata checks still apply. Keep the published port on host loopback.
- **Local transport is off** — the card says off and the listener closes its
  clients with a clear reason. Turning it on starts a fresh listener.
- **Relay is not configured** — the relay card explains local-only mode and the
  environment variables needed for remote access.
- **Relay reconnects** — the card shows the current state, last change, attempt
  count, and a redacted error.
- **Push is off or unavailable** — the card shows the saved choice, the
  effective state, the startup error, and the subscription count. Existing
  subscriptions are kept.
- **Client sync is off** — the web Sync tab disappears, sync actions return
  `disabled`, and the stored namespace and per-device category choices are kept
  for the next enable.
- **Sync interval changes** — connected clients receive the new cadence in an
  agent-info update and reschedule their next check without reconnecting.
- **The agent is stopped** — a banner says external connections are off, every
  transport card shows a stopped state, and feature switches are disabled. An
  enabled feature switch turns red and a disabled one keeps its neutral track.
  The shell, Traffic, and Client sync switches keep their usual colors. The
  shell toggle and draft stay editable.
- **The filter list is empty** — every command is allowed once Apply saves the
  enabled policy, and the card shows a warning. The location requirement and the
  working-directory check still apply.
- **A command is refused** — the agent returns `403` to the client and increments
  the refusal counter on the shell card. The command is never logged; only the
  method, path, and policy code are.
- **A shell entry is invalid** — Apply reports the error and keeps the saved
  policy unchanged; the textarea keeps the draft so it can be fixed.
- **The policy is off** — Clara's Git tab shows that commit history is disabled
  and does not retry.
- **Orchestration changes** — the home agent probes `/health` before and after
  the action, then broadcasts the new `orchestration` flag so connected clients
  add or remove the Workers treatment without a reload. A failed local start
  keeps the error on the card. A Docker or external instance cannot be stopped
  from the panel.
- **A feature fails to start** — the saved choice remains, the card shows the
  error, and the rest of the agent keeps running.
- **No clients** — the client table shows an empty state.
- **A pairing session is listed** — the row carries a **Pairing** badge instead
  of a device. It is the one-time enrollment connection, not a failed client,
  and the agent retires it as soon as the device-enrolled response is sent.
- **The panel is screenshared** — sensitive values load masked and the eye
  button reveals them for the tab. Masked values lose their full-value tooltips
  and copy buttons, and the same scrubber covers activity messages and error
  notices.
- **Monitoring is off** — the Traffic card collapses to its header and switch,
  the client table drops its traffic columns, and no counter moves. Turning it
  on starts a new window.
- **Monitoring is switched off mid-stream** — the counters stop where they are
  and the window is discarded. The stream itself keeps flowing.
- **The first minute after enabling or restarting** — the card says collecting
  and shows no rate or spike until one full minute has been measured.
- **A spike is detected** — the badge and notice name the signal that crossed
  the threshold. A large but legitimate stream raises it too.
- **A storage entry is unhealthy** — the storage header shows an error badge
  when any entry failed, otherwise a warning badge for read-only files, broad
  permissions, or missing required files. The tooltip counts each state.
- **Config permissions are broad** — storage warns when the database,
  `server.json`, `secrets.key`, `admin-setup.txt`, subscriptions, or VAPID keys
  are readable by other users.
- **The panel was not built** — the page returns a short instruction to run
  `pnpm build`; the JSON API still works.
- **Panel port is busy** — the agent logs `panel unavailable` and continues.

## Out of scope

- Non-superadmin panel users and roles; the schema reserves a role column
- Remote access to the panel through the relay
- Editing relay URLs, rooms, tokens, or other `server.json` fields from the
  panel; the Web URL and VAPID contact are the exceptions
- Multiple simultaneously active harnesses; the panel stores one active backend
- Per-device relay tokens; the relay client token remains shared
- A sandbox for command execution, or an allowlist of every proxied API route
- Per-command arguments, wildcards, or regular expressions in the allowlist
- Rate limiting, blocking, or alerts driven by the traffic meter
- Historical metrics beyond the sixty-minute window, persisted logs, or an audit
  trail
- Reading, editing, or deleting individual synced values or namespaces from the
  panel; it controls only the global gate and cadence

## Known gaps

- Authentication is not host isolation. A process with the panel cookie, the
  database, or `secrets.key` can still act as the agent; keep the config and
  data directories private.
- Sessions are in memory, so restarting the agent signs everyone out.
- The superadmin password is hashed; harness passwords are reversible and must
  be encrypted at rest with a backed-up key.
- Device identity is logical, not hardware-bound. The panel shows one row per
  stored device and one row per live connection; multiple tabs share a device.
- Traffic is measured at the agent, so connections the relay rejects before they
  reach it, and Cloudflare-level bandwidth, are visible only in Cloudflare
  analytics.
- The traffic window and the activity list are in memory and reset when the
  agent restarts.
- A session that spans a monitoring toggle shows only the traffic recorded while
  monitoring was on.
- The OpenCode probe is cached for five seconds, so the card can briefly lag a
  restart.
- The peek control hides values in the rendered panel only. The JSON snapshot
  still contains them, so browser devtools and the network panel can show them.

## Technical appendix

<details>
<summary>Routes, data, and references</summary>

- Panel listener: `127.0.0.1:8790` by default; `CLARA_PANEL_BIND_HOST=0.0.0.0`
  inside the container with host-loopback publishing
- Page: `GET /`
- Health: `GET /health` (unauthenticated, no secrets)
- Session: `GET|POST|DELETE /panel/api/v1/session`
- Setup: `POST /panel/api/v1/setup` with `{ "token": "...", "username": "...", "password": "..." }`
- Read API: `GET /panel/api/v1/status` (API version `10`, authenticated)
- Mutations:
  - `POST /panel/api/v1/features` with `{ "feature": "...", "enabled": true }`
  - `POST /panel/api/v1/agent` with `{ "stopped": true }`
  - `POST /panel/api/v1/orchestration` with `{ "enabled": true }`
  - `POST /panel/api/v1/config` with `{ "pairingBaseUrl": "https://..." }` or
    `{ "vapidSubject": "mailto:..." }`; send `null` to restore the default
  - `POST /panel/api/v1/shell` with `{ "mode": "off" | "allowlist", "commands": ["git log"] }`
  - `POST /panel/api/v1/monitoring` with `{ "enabled": false }`
  - `POST /panel/api/v1/sync` with `{ "enabled": true, "intervalMs": 30000 }`
  - `POST /panel/api/v1/harnesses` and `POST /panel/api/v1/harnesses/:id`
  - `POST /panel/api/v1/harnesses/:id/test|activate`
  - `DELETE /panel/api/v1/harnesses/:id`
  - `DELETE /panel/api/v1/devices/:id` revokes the device
  - `POST /panel/api/v1/devices/:id/purge` deletes a revoked device record
  - `POST /panel/api/v1/account/password`
- Required mutation headers: `x-clara-panel: 1`; JSON-body mutations also
  require `content-type: application/json`
- Assets: `GET /assets/<hashed file>` and `GET /favicon.svg`
- Environment:
  - `CLARA_PANEL_PORT` changes the port (default `8790`)
  - `CLARA_PANEL_BIND_HOST` changes the listener (default `127.0.0.1`)
  - `CLARA_PANEL_ALLOW_REMOTE=1` permits a container bridge source; auth remains required
  - `CLARA_PANEL_SECURE_COOKIE=1` for a loopback-preserving HTTPS proxy
  - `CLARA_PANEL_DISABLED=1` disables the panel
  - `CLARA_PAIRING_BASE_URL` overrides the panel Web URL
  - `CLARA_VAPID_SUBJECT` overrides the panel VAPID contact
  - `CLARA_WEB_PORT` sets the default Web URL port (default `8080`)
  - `CLARA_DB_PATH` moves the database (default `<data dir>/clara.db`)
  - `CLARA_SECRET_KEY` or `CLARA_SECRET_KEY_FILE` encrypts harness secrets; otherwise
    `secrets.key` is generated in the config directory
  - `CLARA_ADMIN_SETUP_TOKEN` or `CLARA_ADMIN_SETUP_TOKEN_FILE` supplies the first-run token
- CLI: `clara-server serve --no-panel`, `clara-server admin reset|setup-token`
- Built assets: `apps/server/dist/panel`, copied from `apps/panel/dist`
- Open the built panel: `pnpm clara server panel` opens
  `http://127.0.0.1:${CLARA_PANEL_PORT:-8790}/` in a browser when the agent is
  already serving it; start the agent with `pnpm clara server start --local`
  (or `--docker`) first. The panel is a surface of the home agent, not a
  separate service
- Docker (default): `pnpm clara server start|stop|restart|status|setup-token|pair|admin|logs`;
  `setup-token`, `admin`, and `pair` target the running deployment
  automatically, and `--docker`/`--local` force the container or the host
  install. Pass `--local` to `start`, `stop`, `restart`, or `logs` to use
  the detached local agent instead. `pair --no-relay` emits a local-only code.
  The rebuild snapshot records the home agent as `container` or `local` and
  recreates a container with stop/start instead of signalling a PID. See
  [maintenance.md](maintenance.md).
- Dev UI: `pnpm dev:panel` (Vite on `5174`, proxying `/panel/api` to `8790`; the
  proxy rewrites `Host` and `Origin`, and the browser carries the session cookie)
- Snapshot sections: agent, auth, config, harness, harnesses, devices, local transport,
  relay, clients, push, controls (feature switches, shell, monitoring, sync,
  orchestration), storage, events, traffic
- Shell policy: `apps/server/src/shell-policy.ts` (matching, validation, and the
  `403` decision), `apps/server/src/agent.ts` (enforcement), and the
  `ShellPolicyCard` in `apps/panel/src/components/shell-policy-card.tsx`
- Traffic meter: `apps/server/src/traffic.ts` (sixty one-minute buckets, rates,
  spike detection), fed by `apps/server/src/agent.ts` and read by
  `PanelRuntime`; rendered by the `TrafficCard` in
  `apps/panel/src/components/traffic-card.tsx`
- Panel controls: per-card switches in
  `apps/panel/src/components/overview-cards.tsx`, the stop/start action in
  `AgentCard`, the monitoring switch in `TrafficCard`, the gate and interval in
  `apps/panel/src/components/client-sync-card.tsx`, and `useFeatureControl` in
  `apps/panel/src/lib/feature-control.ts`
- Peek control: `apps/panel/src/lib/peek.ts` (mask and free-text scrubber),
  `apps/panel/src/lib/peek-context.tsx` (tab state), and the header button in
  `apps/panel/src/App.tsx`; the choice is stored under `clara.panel.peek` in
  `sessionStorage`
- Policy storage: `shell.mode` and `shell.commands` in the settings table,
  added by database migration `2`; `monitoring.enabled`, added by migration `3`;
  `sync.enabled` and `sync.intervalMs`, added by migration `4`;
  `orchestration.enabled`, added by migration `5`; panel users, setup tokens,
  harness connections, and harness secrets added by migration `6`
- Database health: path, existence, mode, bytes, schema version, client-sync
  counts and bytes (never values)
- Auth: scrypt password hashes, hashed session tokens in memory, per-source and
  per-username login limits, session-version revocation, one-time setup tokens
- Harness secrets: AES-256-GCM with a per-secret nonce and AAD bound to the
  connection and field; the key lives outside SQLite
- Guards: authenticated session for `/panel/api/*`, optional bridge source
  allowance, `Host`, `Origin`, `Sec-Fetch-Site`, guarded JSON mutations, path
  allowlist, CSP, `no-store`, no CORS
- Related: [agent-controls.md](agent-controls.md), [git.md](git.md),
  [sync.md](sync.md), [overview.md](../architecture/overview.md),
  [pairing.md](pairing.md), [connection.md](connection.md),
  [notifications.md](notifications.md)

</details>
