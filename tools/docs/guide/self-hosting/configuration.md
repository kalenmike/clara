---
title: Configuration
description: Connect a harness, set the Web URL, and tune the hub.
sidebar_position: 3
---

# Configuration

Most settings live in the authenticated hub panel. A few deployment values can be
set with environment variables, which take precedence over the panel files.

## Connect a harness

1. Start the hub and open the panel.
2. Open **Harness**, use **Add harness**, choose the adapter type and where the
   adapter runs. OpenCode is the only adapter type included with this release.
3. Copy the pairing code or install command and run it on the harness machine.
4. The adapter connects out to the hub. **Paired harnesses** shows
   **Paired · Offline** until the adapter connects, then **Online** with a live
   row under **Connected adapters**. Use **Test** to probe it and **Activate**
   to choose the backend.

Only one adapter is active at a time. Re-pairing keeps the adapter identity and
Clara session metadata.

The adapter, not the hub, discovers and authenticates the harness. The hub never
contacts the harness and does not read OpenCode's `service.json`. Adapter
credentials live in the hub's SQLite database, encrypted at rest. The harness URL
and password stay in the adapter's own config on the harness machine.

In Docker, the adapter connects to `ws://server:8788/ws` on the `clara`
network. `127.0.0.1` means the adapter container itself.

## Set the Web URL

Pairing links use the **Web URL** in **Settings → Web URL**. The default is
`http://127.0.0.1:8080`. Set it to your public HTTPS URL before pairing remote
devices.

`CLARA_PAIRING_BASE_URL` overrides the panel value. `CLARA_WEB_PORT` changes the
default port used when no Web URL is set.

## Push notifications

The panel's **VAPID contact** is the contact address sent with Web Push. It
defaults to `https://clara.local`. Set a real `mailto:` or HTTPS address.
`CLARA_VAPID_SUBJECT` overrides the file.

VAPID keys are generated in the config directory. You can supply
`CLARA_VAPID_PUBLIC_KEY` and `CLARA_VAPID_PRIVATE_KEY` to keep them stable across
hosts.

## Shell policy

The panel's **Shell commands** switch controls whether Clara clients may ask the
adapter to run a host command for the harness. When it is on, **Filter commands**
is an optional allowlist; an empty list allows every command. **Allow Git
history** permits the read-only Git history query used by the Git tab.

The policy is a guardrail, not a sandbox. It does not restrict file writes, agent
prompts, or the harness API.

## Settings sync

**Settings sync** can be enabled or disabled for every paired client, with a
check interval. When it is off, the web Sync tab is hidden and sync requests are
rejected. Each device keeps its own category choices; the hub stores the shared
values.

## Environment variables

| Variable                                                   | Purpose                                                      |
| ---------------------------------------------------------- | ------------------------------------------------------------ |
| `CLARA_PANEL_PORT`                                         | Hub panel port (default `8790`)                              |
| `CLARA_PANEL_BIND_HOST`                                    | Panel listener (default `127.0.0.1`)                         |
| `CLARA_PANEL_ALLOW_REMOTE`                                 | Permit a container bridge source; auth is still required     |
| `CLARA_PANEL_SECURE_COOKIE`                                | Use a secure cookie behind a loopback-preserving HTTPS proxy |
| `CLARA_PANEL_DISABLED`                                     | Disable the panel                                            |
| `CLARA_PAIRING_BASE_URL`                                   | Public web URL used in pairing links                         |
| `CLARA_VAPID_SUBJECT`                                      | Web Push contact                                             |
| `CLARA_WEB_PORT`                                           | Default web port for pairing links (default `8080`)          |
| `CLARA_DB_PATH`                                            | Move the SQLite database                                     |
| `CLARA_CONFIG_DIR`                                         | Move configuration files                                     |
| `CLARA_DATA_DIR`                                           | Move data files and logs                                     |
| `CLARA_SECRET_KEY` / `CLARA_SECRET_KEY_FILE`               | Encrypt adapter credentials instead of using `secrets.key`   |
| `CLARA_ADMIN_SETUP_TOKEN` / `CLARA_ADMIN_SETUP_TOKEN_FILE` | Supply the first-run setup token                             |
| `CLARA_RELAY_URL`                                          | Relay endpoint                                               |
| `CLARA_RELAY_ROOM`                                         | Relay room; generated and persisted when omitted             |
| `CLARA_AGENT_TOKEN`                                        | Relay token for the hub side                                 |
| `CLARA_CLIENT_TOKEN`                                       | Relay token embedded in pairing payloads                     |

The relay variables are covered in [Remote access](relay.md). In Docker, setting
`CLARA_RELAY_URL` without both relay tokens is a startup error; `pnpm clara start`
reports the missing variables before it launches a container.

## Files worth backing up

- The hub database (`CLARA_DB_PATH` or `clara.db`).
- `secrets.key` (or `CLARA_SECRET_KEY`).
- `server.json` and `vapid.json`.
- `subscriptions.json`.

The Docker volumes already group these. For a local install, back up the config
and data directories. See [Updates and backups](updates.md).

## Related

- [Docker](docker.md)
- [Local install](local.md)
- [Remote access](relay.md)
- [Security and privacy](../security.md)
