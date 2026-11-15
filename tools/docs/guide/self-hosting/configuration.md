---
title: Configuration
description: Connect a harness, set the Web URL, and tune the hub.
sidebar_position: 3
---

# Configuration

Most settings live in the authenticated hub panel. A few deployment values can be
set with environment variables, which take precedence over the panel files.

## Create the owner account

The first run serves only the loopback setup screen. The local WebSocket, relay,
harness routing, push, orchestration, and pairing stay stopped until the owner
account exists. Create it in the panel, or from a shell:

```bash
node apps/hub/server/dist/index.js setup --password-stdin
```

For an unattended start, set `CLARA_ADMIN_USERNAME` and
`CLARA_ADMIN_PASSWORD` or `CLARA_ADMIN_PASSWORD_FILE` before the hub starts. The
environment owner is created before any transport starts and the setup screen is
skipped. The password must be at least 12 characters. A configured hub ignores
the environment values rather than overwriting its password. Prefer
`CLARA_ADMIN_PASSWORD_FILE` for Docker or CI because a plain environment value
is visible to `docker inspect` and process listings.

`CLARA_ADMIN_SETUP_TOKEN` or `CLARA_ADMIN_SETUP_TOKEN_FILE` is the explicit
remote setup path. When set, the setup form also asks for that token.

For a remote hub, prefer the environment owner or the headless setup command
before the first start. The setup page is loopback-only, so a client on another
machine cannot create the first owner. After the owner exists, pair Clara
Desktop and choose **Hub** in the app to use the panel over the encrypted
connection.

## Guided setup

After the owner account exists, the panel opens a dismissible Setup modal:

1. Choose **Local only** or **Remote via relay**. The relay path embeds the
   relay editor and the Web URL; it continues only when the relay is online and
   the Web URL is HTTPS.
2. Pair a harness. The setup path preselects **Remote** or **Local**.
3. Pair a client. The pairing link uses the Web URL chosen in step 1.
4. Read **How Clara works**.

The modal can be skipped. While setup is incomplete, resume it from
**Settings → Setup → Finish setup**. After it is complete it never reopens
automatically; **Settings → Setup → Reconfigure connections** runs the same flow
with the current values, and **Replay setup guide** opens the guide. Changing the
relay or its room can require adapters and devices to pair again.

## Connect a harness

1. Start the hub and open the panel.
2. Open **Harness** and choose **Pair Harness**. Choose the adapter type and
   answer remote or local; a direct WebSocket URL under **Advanced** is available
   when the adapter reaches the hub at another address. The hub returns a
   one-time code and command. Turn on adapter setup in
   **Settings → Adapter downloads** first. Clara Desktop can install it on this
   computer, an SSH host, or a local container.
3. Run the copied command on the harness machine, or install from Clara Desktop.
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

## Adapter downloads

**Settings → Adapter downloads** sets the registry URL and turns SSH/Docker
installs on or off. The registry publishes one manifest per harness at
`<registry>/<harness>/manifest.json`; the default registry is
`https://clara.kalenmichael.com/adapters`. The hub reads the manifest, verifies
the install script, and runs it on the target. It never downloads the adapter
itself, and the panel lets the target download the platform build.

`CLARA_ADAPTER_REGISTRY_URL` overrides the panel value. Installs are off by
default and are available only when the panel is loopback-only and the hub runs
as a local process. A containerized hub or a remote-exposed panel uses the
manual command instead.

## Set the Web URL

Pairing links use the **Web URL** in **Settings → Web URL**. The default is
`http://127.0.0.1:8080`. Set it to your public HTTPS URL before pairing remote
devices.

`CLARA_PAIRING_BASE_URL` overrides the panel value. `CLARA_WEB_PORT` changes the
default port used when no Web URL is set.

## Direct adapter access

The local WebSocket listener is loopback-only by default. The panel's
**Network → Local transport → Listen on** setting chooses which interfaces it
binds:

- **This machine only** — loopback.
- **This machine and local Docker containers** — loopback plus Docker bridge
  addresses.
- **All interfaces** — LAN, Docker, and loopback.
- **Custom address** — loopback plus an address you type.

`CLARA_LOCAL_ACCESS` (`loopback`, `docker`, `lan`, or `custom`) overrides the
panel value, and `CLARA_LOCAL_BIND_HOST` supplies the custom address. Changing
the setting restarts only the local listener; the panel stays up. All interfaces
exposes the hub WebSocket and API to your network, so keep the port behind your
firewall. For Docker Desktop, use **All interfaces** and `host.docker.internal`,
or use the relay. Public and cloud installs should use the relay.

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

| Variable                                                   | Purpose                                                        |
| ---------------------------------------------------------- | -------------------------------------------------------------- |
| `CLARA_PANEL_PORT`                                         | Hub panel port (default `8790`)                                |
| `CLARA_PANEL_BIND_HOST`                                    | Panel listener (default `127.0.0.1`)                           |
| `CLARA_PANEL_ALLOW_REMOTE`                                 | Permit a container bridge source; auth is still required       |
| `CLARA_PANEL_SECURE_COOKIE`                                | Use a secure cookie behind a loopback-preserving HTTPS proxy   |
| `CLARA_PANEL_DISABLED`                                     | Disable the panel                                              |
| `CLARA_LOCAL_ACCESS`                                       | Direct access: `loopback`, `docker`, `lan`, or `custom`        |
| `CLARA_LOCAL_BIND_HOST`                                    | Bind address for custom direct access                          |
| `CLARA_LOCAL_HOST`                                         | Advertised local host in pairing links                         |
| `CLARA_LOCAL_PORT`                                         | Local WebSocket port (default `8788`)                          |
| `CLARA_PAIRING_BASE_URL`                                   | Public web URL used in pairing links                           |
| `CLARA_VAPID_SUBJECT`                                      | Web Push contact                                               |
| `CLARA_WEB_PORT`                                           | Default web port for pairing links (default `8080`)            |
| `CLARA_DB_PATH`                                            | Move the SQLite database                                       |
| `CLARA_CONFIG_DIR`                                         | Move configuration files                                       |
| `CLARA_DATA_DIR`                                           | Move data files and logs                                       |
| `CLARA_SECRET_KEY` / `CLARA_SECRET_KEY_FILE`               | Encrypt adapter credentials instead of using `secrets.key`     |
| `CLARA_ADMIN_USERNAME`                                     | Owner username created at startup with a password              |
| `CLARA_ADMIN_PASSWORD` / `CLARA_ADMIN_PASSWORD_FILE`       | Create the owner before transports start; skip setup screen    |
| `CLARA_ADMIN_SETUP_TOKEN` / `CLARA_ADMIN_SETUP_TOKEN_FILE` | Require a host-supplied token on the setup form                |
| `CLARA_RELAY_URL`                                          | Relay endpoint; wins over the panel when set                   |
| `CLARA_RELAY_ROOM`                                         | Relay room; generated when omitted and never typed by hand     |
| `CLARA_AGENT_TOKEN`                                        | Relay hub token; signs grants and wins over the panel when set |

The relay variables are covered in [Remote access](relay.md). The relay token
must be 32 to 512 characters and cannot contain spaces or commas. Each variable
wins over the matching panel value when it is set; otherwise the panel is used.
In Docker, setting `CLARA_RELAY_URL` without the environment token is allowed
when the panel has saved it, so `clara start` warns instead of blocking.

## Files worth backing up

- The hub database (`CLARA_DB_PATH` or `clara.db`).
- `secrets.key` (or `CLARA_SECRET_KEY`).
- `server.json` and `vapid.json`.
- `relay-credentials.json` when the relay is configured in the panel.
- `subscriptions.json`.

The Docker volumes already group these. For a local install, back up the config
and data directories. See [Updates and backups](updates.md).

## Related

- [Docker](docker.md)
- [Local install](local.md)
- [Remote access](relay.md)
- [Security and privacy](../security.md)
