---
title: Hub CLI
description: Run the Clara hub as a single command-line executable.
sidebar_position: 10.5
---

# Hub CLI

The Clara hub can run as a single command-line executable named `clara-server`.
It contains the hub service and the authenticated panel. This is an alternative
to the Docker stack or a local Node install; the web client and desktop client
are separate downloads.

## Build the executable

From a checkout, run:

```bash
pnpm install
pnpm hub:binary
```

The build prints the path to the executable. Copy it somewhere stable, or run it
in place. Cross-builds accept a Bun target such as `bun-linux-x64` or
`bun-darwin-arm64`.

To build an archive with an install helper for a Linux systemd user unit, macOS
LaunchAgent, or Windows sign-in task, run:

```bash
pnpm hub:headless
```

The archive is written under `dist/headless`. Build each platform on its own
machine; a Linux machine cannot build the macOS or Windows executables.

## Run the hub

```bash
./clara-server serve
```

The panel listens on `http://127.0.0.1:8790/` by default. On first run the hub
starts only the panel and no transports. Create the hub owner account in the
panel, or from the command line:

```bash
./clara-server setup --username admin --password-stdin
```

The Setup modal then asks for the connection path. Choose **Local only** or set
up the relay with an HTTPS Web URL, pair a harness, and pair a client. It can be
dismissed and resumed from **Settings → Setup**.

Pairing a harness creates a one-time code and command. The hub never runs the
installer; run the command on the harness machine, or use Clara Desktop for a
one-click install. Turn on adapter setup under **Settings → Adapter downloads**
first.

For an unattended install, set `CLARA_ADMIN_USERNAME` and
`CLARA_ADMIN_PASSWORD` or `CLARA_ADMIN_PASSWORD_FILE` before starting the hub.

## Panel appearance

Open **Settings → Appearance** to choose **Light**, **Dark**, or **System** for
the served hub panel. **System** follows the operating system setting. The choice
is stored in the panel on this device and also applies to the sign-in screen.

The panel uses the same palette, fonts, and text sizes as Clara. When you open it
from the web or desktop client at `/hub`, it follows that client's mode and color
theme instead and hides the panel's own switch.

## Ports

The hub chooses its panel and local ports instead of relying on fixed ones.

- The panel reuses its previous port when it can. If another program has that
  port, the hub picks a free one.
- The local WebSocket port is reused across restarts. If it is busy, the hub
  chooses a free port and records it.
- The desktop client reads the current local port and reconnects. Devices and
  adapters that use the local connection may need a new pairing after a port
  change. Devices connected through the Cloudflare relay are unaffected.
- The Docker installation keeps fixed ports because pairing links need the
  published host port.

The live panel URL is written to the hub runtime file. Use `clara status hub` or
`clara status hub --open` to inspect or open it.

## Remote clients

Pairing through the Cloudflare relay works the same as in Docker. The hub does
not serve the web client; run the web app where you host it today and pair it
with the hub panel.

## Logs and troubleshooting

The hub logs to its process output. Under a service manager, read the unit or
container log. If the hub exits, the service manager or container restarts it;
SQLite is checkpointed on shutdown.

A second start for the same data directory prints the running endpoints and
exits instead of starting another hub.

If the panel already has a relay URL but the hub token is missing, the hub still
starts and runs local-only. Save the hub token in **Connections → Relay** to
connect the relay; no restart is needed.

## Related

- [Self-hosting overview](self-hosting/index.md)
- [Headless server](self-hosting/headless.md)
- [Docker](self-hosting/docker.md)
- [Configuration](self-hosting/configuration.md)
- [Remote access](self-hosting/relay.md)
- [Desktop client](desktop.md)
