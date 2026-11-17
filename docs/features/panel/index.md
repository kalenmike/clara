---
title: Hub panel
description: The authenticated hub dashboard, owner setup, and the Overview.
sidebar_position: 1
---

# Hub panel

## Summary

The hub panel is the authenticated control surface served by the hub service. It
uses the Clara Lab workbench layout: title bar, activity rail, and status bar. It
shows live state, transports, clients, adapters, sessions, push, configuration,
storage, and traffic without exposing secrets. Every paired harness is a peer;
a request naming neither a session nor a workspace must name its harness.

It is also the setup surface for the owner account, browser pairing, and
adapters. On first run it serves only a local setup screen until the owner
exists. The UI is `@clara/panel`, so `/hub` mounts the same views through the
paired E2EE session and `/v1/hub-panel` bridge; the served page remains the
first-run, headless, and emergency surface.

## User flow

1. Start the hub with `clara start hub`, then open the URL it prints, which is
   `http://127.0.0.1:8790/` by default. `clara status hub --open` only opens a
   panel that is already being served. See [hub-service.md](../hub-service.md).
2. On first run, **Create the hub owner account** asks for a username, password,
   and confirmation. The route is local-only, and no transport, pairing, probe,
   push, or orchestration starts until the account exists. A headless install can
   run `clara-server setup --username <name> --password-stdin`, or set
   `CLARA_ADMIN_USERNAME` with `CLARA_ADMIN_PASSWORD` or its `_FILE` variant. A
   host-supplied `CLARA_ADMIN_SETUP_TOKEN` adds token mode.
3. A dismissible **Setup** modal derives progress from the live snapshot. Choose
   **Local only** or **Remote via relay** with the relay editor and Web URL, then
   pair a harness and a client. Path, harness, and client are required; resume
   from **Settings → Setup**. It never reopens automatically after completion.
4. Sign in with the owner account. **Keep me signed in** is on by default. After
   a host reset, the sign-in screen accepts the one-time reset token and a new
   password.
5. **Overview** leads with six health tiles — Hub, Local, Relay, Harness, Push,
   and Orchestration — then **Needs attention**, Active clients and Active
   adapters previews, five recent events, and a storage summary. Each preview card
   puts **View all** bottom right; the connection cards show their badge by the
   title and a **Pair** shortcut top right. Tiles open their view (Hub → Settings,
   Orchestration → Network); **Go offline** sits at the far right.
6. The activity rail holds **Home** (Overview), **Harness**, **Clients**,
   **Network**, **Traffic**, **Activity**, **Sessions**, and **Settings**. Views
   are hash links and keep scroll; cards open from their header, and a feature
   that is off cannot expand. Every Network card starts collapsed.
7. The title bar carries peek and **Refresh** icon buttons plus **Sign out**. Peek
   unmasks ids, fingerprints, paths, endpoints, relay room, and session ids.
8. In Clara, open **Hub** for the same views at `/hub`; the app holds the token,
   disables tunnel-cutting controls, polls every five seconds while visible,
   pauses while hidden, and **Refresh** checks immediately.

## Core business rules

1. **Authenticated and loopback by default.** The panel listens on
   `127.0.0.1:8790`; every API request except health, session, setup, and assets
   needs a superadmin session. `CLARA_PANEL_BIND_HOST` and
   `CLARA_PANEL_ALLOW_REMOTE` are exposure controls, but the `Host`/`Origin`
   guard still expects loopback, so remote access uses an SSH tunnel. The panel
   is never served through the relay or Pages.
2. **First run blocks the hub.** With no owner account, panel API routes except
   health, assets, session, and setup return `503 setup_required`; transports and
   pairing stay stopped. The password is scrypt-hashed; only host-side
   `clara-server admin reset` can recover it, with a one-time token that revokes
   sessions. Session token hashes last 30 minutes idle and 12 hours absolute, or
   30 days and 90 days when remembered.
3. **Secrets stay out of the snapshot.** The snapshot is an allowlist. Device
   keys, one-time codes, adapter credentials, the relay token, push endpoints,
   sync values, and file contents are never returned; a pairing code appears only
   in the response that creates it. Those secrets are encrypted at rest with a
   key outside SQLite. Peek masks the rendered panel only, never the JSON.
4. **Settings are durable, presentation is local.** Feature choices, the stopped
   flag, monitoring, orchestration, sync, adapter setup, users, and harness
   connections live in SQLite and load before any transport. Web URL and relay
   target live in `server.json`, the VAPID contact in `vapid.json`, and the relay
   token in encrypted `relay-credentials.json`. Appearance and peek are
   browser-local. A panel failure never stops the hub.
5. **Guided setup is derived, and hosts differ.** Completion comes from the
   snapshot: a local path, or an online relay with an HTTPS Web URL; one paired
   harness; and one non-revoked device. Path, dismissal, completion, and
   guide-seen timestamps live in `localStorage`. The served page allows every
   control. `/hub` blocks **Go offline**, its carrying transport switch, and relay
   target edits; the bridge adds no port and is not a proxy.

## Read when

| Document                                      | Read when…                                                 |
| --------------------------------------------- | ---------------------------------------------------------- |
| [controls.md](controls.md)                    | You need feature switches, offline, sync, or orchestration |
| [access.md](access.md)                        | You need clients, devices, pairing, or adapters            |
| [network.md](network.md)                      | You need the listener, relay, push, traffic, or storage    |
| [connection.md](../connection.md)             | You are connecting a client to a hub                       |
| [harness-adapters.md](../harness-adapters.md) | You are working on adapter pairing or transport            |

## Edge cases

- **No owner account** — only setup is served, the API returns
  `503 setup_required`, and transports and pairing stay stopped. The hub exits if
  the panel is disabled and no environment owner is configured.
- **Remote setup** — the `Host`/`Origin` guard rejects it. Use an SSH tunnel,
  configure `CLARA_ADMIN_PASSWORD` before startup, or use a setup token.
- **Lost superadmin password** — the reset token link appears on sign-in until
  the token is used or expires; there is no HTTP reset route. A wrong or expired
  setup token returns a generic error and keeps the form.
- **Session expires or is revoked** — the next poll returns `401`, sign-in
  replaces the dashboard, and no stale data is shown.
- **Panel not built or its port is busy** — the page asks for `pnpm build`; the
  JSON API still works. A busy port falls back to an ephemeral one.
- **Storage cleared or `/hub` disconnected** — clearing local storage can reopen
  the setup modal but keeps pairings. Without a connection, `/hub` sends the
  client to the connect screen; it has no loopback fallback.

## Out of scope

- Non-superadmin panel users and roles
- Serving the panel page through the relay or Pages
- Editing `server.json` fields beyond the Web URL, relay target, and room
- A hub-wide default harness or per-device relay targets

## Technical appendix

<details>
<summary>Routes, data, and references</summary>

- Listener `127.0.0.1:8790`; `CLARA_PANEL_PORT` and `CLARA_PANEL_BIND_HOST`
  change it, and `CLARA_PANEL_ALLOW_REMOTE=1` is the other exposure control.
- Page `GET /`; health `GET /health` (no secrets, including `setupRequired` and
  `setupTokenRequired`); snapshot `GET /panel/api/v1/status` (API version `13`);
  session `GET|POST|DELETE /panel/api/v1/session`; setup
  `POST /panel/api/v1/setup` with `username`, `password`, and an optional token.
- Mutations `POST` features, agent stop, orchestration, monitoring, sync,
  config, relay, relay room, and password. Device and harness routes are in
  [access.md](access.md); transport and storage routes in
  [network.md](network.md). Every mutation sends `x-clara-panel: 1`; JSON bodies
  also send `content-type: application/json`. Bodies are capped at 8 KB, unknown
  fields are rejected, and no CORS headers are sent.
- Bundled panel `/hub` renders `packages/panel`; `/v1/hub-panel` forwards typed
  panel API requests without adding a listener. Assets live in
  `apps/hub/server/dist/panel`.
- Related: [controls.md](controls.md), [access.md](access.md),
  [network.md](network.md), [hub-service.md](../hub-service.md),
  [capabilities.md](../capabilities.md),
  [overview.md](../../architecture/overview.md), and
  [relay.md](../../architecture/relay.md)

</details>
