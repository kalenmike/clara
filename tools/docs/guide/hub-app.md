---
title: Hub app
description: Run the Clara hub and panel from a desktop tray app.
sidebar_position: 10.5
---

# Hub app

The Clara Hub app runs the hub service and opens its panel from a desktop tray
icon. It is an alternative to the Docker stack or a local Node install. The web
client and the desktop client are separate downloads; this app only hosts the
hub.

## Build an installer

There is no hosted download yet. Build the app on the operating system where
you will run it. The build needs Bun, the Rust toolchain, and that platform's
WebView development packages.

### Linux with Docker

Docker builds the Linux bundles and copies them to the `dist/hub` folder. This
is the easiest path when the machine lacks Bun, Rust, or the WebView development
packages.

```bash
pnpm hub:build:docker                      # deb, rpm, and AppImage
pnpm hub:build:docker --bundles deb,rpm    # narrower bundle set
pnpm hub:build:docker --platform linux/amd64
```

The first build downloads the Bun, Node, and Rust toolchains and takes a while;
later builds reuse the Docker cache. The container is based on Debian 12, so the
bundles target Debian 12 and newer distributions. Docker cannot produce macOS or
Windows installers.

### On the host

```bash
pnpm install
pnpm hub:build
```

The installer is written under the hub app's Tauri bundle output. `pnpm
hub:build:app` produces the app binary without installers. To rebuild only the
hub executable and panel, run `pnpm hub:sidecar`.

## First run

1. Launch Clara Hub. A tray icon appears and the panel opens.
2. Create the hub owner account in the panel. The hub starts no transports until
   the account exists; after you submit, it starts in the same process.
3. Follow the Setup modal: choose Local only or set up the relay, pair a harness,
   then pair a client. You can dismiss it and resume from **Settings → Setup**.
   Pairing a harness asks whether it runs **Remote** or **Local**, then installs
   over SSH or Docker, or copies the code for you to run. Turn on install actions
   under **Settings → Adapter downloads** first; the app uses your SSH
   configuration and Docker socket to run the adapter installer on the machine or
   container you choose.
4. Leave the app running in the tray. Use **Open panel** whenever you need the
   hub settings.

The tray menu has **Open panel** and **Quit**. Closing the panel window hides
it; Quit stops the hub.

## Panel appearance

Open **Settings → Appearance** to choose **Light**, **Dark**, or **System** for
the hub panel. **System** follows the operating system setting. The choice is
stored in the panel on this device and also applies to the sign-in screen.

The web and desktop clients have their own Appearance settings; changing the
panel does not change them.

## Ports

The hub app chooses its panel and local ports instead of relying on fixed ones.

- The panel reuses its previous port when it can. If another program has that
  port, the hub picks a free one and the tray opens the panel on the new port.
- The local WebSocket port is reused across restarts. If it is busy, the hub
  chooses a free port and records it.
- The desktop client reads the current local port and reconnects. Devices and
  adapters that use the local connection may need a new pairing after a port
  change. Devices connected through the Cloudflare relay are unaffected.
- The Docker installation keeps fixed ports because pairing links need the
  published host port.

You never need to type a port into the app; the tray and the panel follow the
hub's live selection.

## Remote clients

Pairing through the Cloudflare relay works the same as in Docker. The hub app
does not serve the web client; run the web app where you host it today and pair
it with the hub panel.

## Logs and troubleshooting

The hub writes its log in the app log directory. If the hub stops unexpectedly,
the tray shows a message. A second launch focuses the existing app instead of
starting another hub for the same data directory.

The hub desktop app cannot start the local orchestration service. Use the
Docker orchestrator or the CLI when you need pipelines.

If the panel already has a relay URL but the hub token is missing, the hub still
starts and runs local-only. Save the hub token in **Connections → Relay** to
connect the relay; no restart is needed.

## Related

- [Self-hosting overview](self-hosting/index.md)
- [Docker](self-hosting/docker.md)
- [Configuration](self-hosting/configuration.md)
- [Remote access](self-hosting/relay.md)
- [Desktop client](desktop.md)
