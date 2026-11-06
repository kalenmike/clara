# Agent panel

## Summary

A loopback-only control panel served by the Clara home agent. It shows the
agent's live state, transports, connected clients, OpenCode probe, push health,
configuration sources, database health, storage files, and a live traffic meter
without exposing secrets. Sensitive values start masked behind a header peek
control so the panel can be screenshared safely. It also lets the person at the
machine switch external connections on and off, stop the agent without stopping
the process, decide which shell commands a Clara client may relay to OpenCode,
turn traffic monitoring on or off, and gate or pace client settings sync.

## User flow

1. Run `pnpm clara control` after `pnpm build`. If the agent is not already
   serving the panel, the command starts it and waits for the listener. The log
   prints `panel at http://127.0.0.1:8790/`.
2. The command opens that URL in a browser on the same machine. The panel
   connects to the agent's loopback API. If the agent was already running, for
   example under a service manager, the command only opens the URL.
3. The **Agent**, **Effective configuration**, **Connected clients**, and
   **Recent activity** cards start expanded. Every other card starts collapsed.
   Review the headers for the agent process, OpenCode, local transport, relay,
   push, client sync, effective configuration, clients, activity, shell policy,
   and storage. Status chips sit beside each card title, including a storage
   health summary that turns amber for warnings and red for errors. Sensitive
   values start masked: the pairing key, config and storage paths, local
   WebSocket endpoint, relay URL and room, client session ids, and WebSocket
   URLs in activity or errors. Choose the eye button beside **Refresh** to
   reveal them for this tab; the choice survives a reload and a new tab starts
   masked again.
4. Click a card header to expand or collapse its contents. Cards with a feature
   switch can only be expanded while that feature is enabled; open the header
   again to collapse it.
5. Toggle OpenCode, local transport, relay, or push from the switch at the top
   right of its card. The choice is saved immediately. An enabled switch is
   green while the agent runs and red while it is stopped; a disabled switch
   keeps its neutral track in both cases. Turning a feature off hides its
   details; turning it on makes the header expandable.
6. In **Shell commands**, use the switch at the top right to enable or block all
   command requests. Enabling makes the header expandable; open it to edit
   **Filter commands**, optionally turn on **Allow Git history**, then choose
   **Apply** at the bottom right. **Discard** sits to its left. The switch stays
   amber until Apply succeeds, then turns green. Turning it off blocks every
   command immediately. Empty filters mean every command is allowed, and the
   card warns about it.
7. To take every external connection offline, choose **Stop agent** at the top
   right of the Agent card and confirm. The page keeps polling; the banner
   explains that the panel is still available.
8. Choose **Start agent** to restore the saved choices. Feature switches are
   disabled until the agent is started again and show red while they are
   stopped, so the stopped state is readable from the switch colors alone. The
   shell policy stays editable because it only applies while connections are
   up.
9. Review the connected-client table and the storage list. Status badges call
   out degraded OpenCode, relay, push, permissions, or missing files. The
   storage header summarizes the most severe entry and its count.
10. In **Traffic**, read the last minute's in and out rates, the request and
    error rates, the two sparklines for the last hour, and the totals since the
    window started. The card shows the local-versus-relay split, a peak minute,
    and the error breakdown. An amber **Spike** badge means the last complete
    minute was at least three times the previous half hour and above a floor; it
    is a hint, not a verdict.
11. Use the switch at the top left of **Traffic** to stop recording. The card
    collapses to its header, the counters are discarded, and the client table
    drops its traffic columns. Turning it back on starts a fresh window with a
    one-minute warm-up. The switch stays usable while the agent is stopped.
12. In **Client sync**, turn settings sync on or off for every paired client, and
    choose the interval at which those clients check for changes. Turning it off
    hides the web Sync tab and rejects sync requests; the stored namespace and
    each device's category choices remain. The interval defaults to 30 seconds.
13. Leave the page open. It refreshes every five seconds while visible and
    pauses when the tab is hidden. Use **Refresh** for an immediate check.
14. Use **Clara management** to turn the ledger daemon, exception sessions, and
    the Clara agents on or off. Turning it off unregisters the Clara tools,
    stops the daemon without opening the ledger, and leaves ordinary session
    alerts unchanged. It also marks the generated agent files
    disabled and reloads OpenCode, so the agents leave the catalog without a
    reinstall; turning it back on restores them. The switch is hidden when the
    build excludes the feature with `VITE_CLARA_MANAGEMENT=0`.

## Core business rules

1. **Loopback only.** The panel listens on `127.0.0.1` independently of
   `CLARA_LOCAL_HOST`, so exposing the local WebSocket on a LAN does not expose
   the panel. It is never served through the relay or the Pages deployment.
2. **Reads are open to loopback; writes are narrow.** `GET` and `HEAD` serve the
   snapshot and assets. `POST` is accepted only at
   `/panel/api/v1/features`, `/panel/api/v1/agent`, `/panel/api/v1/shell`,
   `/panel/api/v1/monitoring`, `/panel/api/v1/sync`, and
   `/panel/api/v1/management`; every other mutating method returns `405`.
3. **Secrets stay out.** The snapshot is built from an explicit allowlist. The
   PSK, pairing code, OpenCode password, relay tokens, push endpoints, sync
   values, and file contents are never returned. The PSK fingerprint, token
   presence, room id, and effective config values are included in the snapshot
   and start masked in the panel.
4. **Mutations are browser-hard to forge.** Besides the loopback, `Host`,
   `Origin`, and `Sec-Fetch-Site` checks, writes require
   `content-type: application/json` and `x-clara-panel: 1`, reject unknown
   fields, and cap the body at 8 KB. The custom header forces a CORS preflight
   for cross-origin pages, which the server rejects. No CORS headers are sent.
5. **Settings are durable.** Feature choices, the stopped flag, the shell
   policy, the monitoring choice, the Clara management switch, and the
   client-sync gate and interval live in the agent's SQLite database and are
   loaded before any transport starts. The panel can fail without stopping the
   agent; a busy panel port only loses the panel.
6. **The shell policy is read per request.** The agent consults it before
   forwarding a command request, so Apply takes effect on the next command
   without a restart. `off` refuses them all. `allowlist` with an empty filter
   list allows every command, but still requires a location and refuses a
   working directory outside it. A non-empty list admits a request only when a
   saved entry is a literal argv prefix of it. Entries cannot contain shell
   syntax, and interpreters such as `sh`, `env`, or `python` cannot be saved.
7. **This is a guardrail, not a sandbox.** The policy governs command requests
   relayed by this agent. It does not restrict the rest of the OpenCode API: file
   writes, prompts that let an agent run tools, and plugin RPC can still affect
   the host. Direct connections bypass the agent entirely. See [git](git.md) for
   the full caveat.
8. **Traffic monitoring is advisory and in memory.** The meter counts frame
   sizes, decrypted request actions, and the failures the agent already detects;
   it never reads or stores payloads. Counters live in a sixty-minute ring of
   one-minute buckets and reset on restart or when monitoring is switched off.
   Nothing is throttled, blocked, or persisted, and the per-client counters are
   hidden while monitoring is off.
9. **Peek is presentation-only.** The eye button masks the pairing fingerprint,
   config and storage paths, local WebSocket endpoint, relay URL and room, client
   session ids, and WebSocket URLs in activity messages and error notices. It
   does not redact the JSON snapshot, change any control, or reach the server:
   the agent's allowlist remains the security boundary. The choice lives in
   `sessionStorage` for the tab, so a reload keeps it and a new tab starts
   masked.

## Edge cases

- **OpenCode is down or rejects the password** — the OpenCode card shows
  unreachable, timed out, or auth rejected, with the last check time. The agent
  keeps running.
- **OpenCode is turned off** — the card says disabled, the probe is not run, and
  proxied requests fail with a disabled error. Local and relay clients stay
  connected.
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
- **Clara management changes** — the panel rewrites `disabled` in the generated
  Clara agent files and reloads OpenCode before it broadcasts the new flag. The
  home agent reconciles the files at startup too. Files edited after
  installation are left alone and reported in the agent log. A switch change
  reloads even when no file changed, so the plugin re-evaluates its tool
  registration.
- **A feature fails to start** — the saved choice remains, the card shows the
  error, and the rest of the agent keeps running.
- **No clients** — the client table shows an empty state.
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
  `server.json`, subscriptions, or VAPID keys are readable by other users.
- **The panel was not built** — the page returns a short instruction to run
  `pnpm build`; the JSON API still works.
- **Panel port is busy** — the agent logs `panel unavailable` and continues.

## Out of scope

- Authentication or multi-user accounts for the panel
- Remote access to the panel through the relay
- Editing connection URLs, ports, rooms, tokens, or `server.json` from the panel
- Kicking clients or revoking a device
- A sandbox for command execution, or an allowlist of every proxied API route
- Per-command arguments, wildcards, or regular expressions in the allowlist
- Rate limiting, blocking, or alerts driven by the traffic meter
- Historical metrics beyond the sixty-minute window, persisted logs, or an audit
  trail
- Reading, editing, or deleting individual synced values or namespaces from the
  panel; it controls only the global gate and cadence

## Known gaps

- Loopback is not user isolation. Any process on the machine, and any browser
  extension with loopback access, can read and change the panel.
- There is no per-device identity; the panel shows one entry per live E2EE
  session.
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

- Panel listener: `127.0.0.1:8790` by default
- Page: `GET /`
- Read API: `GET /panel/api/v1/status` (API version `5`)
- Mutations:
  - `POST /panel/api/v1/features` with `{ "feature": "...", "enabled": true }`
  - `POST /panel/api/v1/agent` with `{ "stopped": true }`
  - `POST /panel/api/v1/management` with `{ "enabled": true }`
  - `POST /panel/api/v1/shell` with `{ "mode": "off" | "allowlist", "commands": ["git log"] }`
  - `POST /panel/api/v1/monitoring` with `{ "enabled": false }`
  - `POST /panel/api/v1/sync` with `{ "enabled": true, "intervalMs": 30000 }`
- Required mutation headers: `content-type: application/json`,
  `x-clara-panel: 1`
- Assets: `GET /assets/<hashed file>` and `GET /favicon.svg`
- Environment:
  - `CLARA_PANEL_PORT` changes the port (default `8790`)
  - `CLARA_PANEL_DISABLED=1` disables the panel
  - `CLARA_PANEL_DIR` overrides the built asset directory
  - `CLARA_DB_PATH` moves the database (default `<data dir>/clara.db`)
- CLI: `clara-server serve --no-panel`
- Built assets: `apps/server/dist/panel`, copied from `apps/panel/dist`
- Open the built panel: `pnpm clara control` starts the agent when the panel is
  not already answering, opens `http://127.0.0.1:${CLARA_PANEL_PORT:-8790}/`,
  and stays attached to the agent it started
- Dev UI: `pnpm dev:panel` (Vite on `5174`, proxying `/panel/api` to `8790`; the
  proxy rewrites `Host` and `Origin` so guarded mutations pass)
- Snapshot sections: agent, config, OpenCode, local transport, relay, clients,
  push, controls (feature switches, shell, monitoring, sync), storage, events,
  traffic
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
  `sync.enabled` and `sync.intervalMs`, added by migration `4`
- Database health: path, existence, mode, bytes, schema version, client-sync
  counts and bytes (never values)
- Guards: loopback remote address, `Host`, `Origin`, `Sec-Fetch-Site`,
  `GET`/`HEAD` reads, five guarded `POST` routes, path allowlist, CSP,
  `no-store`, no CORS
- Related: [agent-controls.md](agent-controls.md), [git.md](git.md),
  [sync.md](sync.md), [overview.md](../architecture/overview.md),
  [pairing.md](pairing.md), [connection.md](connection.md),
  [notifications.md](notifications.md)

</details>
