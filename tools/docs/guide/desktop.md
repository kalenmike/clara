---
title: Desktop app
description: Run Clara in its own native window instead of a browser tab.
sidebar_position: 11.5
---

# Desktop app

Clara can run in its own native window as well as in the browser. The desktop
app is the same client: your hub, projects, sessions, chat, and settings are
unchanged. It is an extra way to open Clara, not a replacement for the web app
or the home-screen install.

Clara Desktop is the single GUI install for using Clara: the chat client and the
hub panel share one window. The hub itself is still a service you run
separately, with the [Hub CLI](hub-cli.md), Docker, or a local install. The
desktop app does not run the hub service.

## Build an installer

There is no hosted download yet, so build the app from a checkout of the
repository.

### Linux with Docker

Docker builds the Linux bundles and copies them to the `dist/desktop` folder.
This is the easiest path when the machine lacks the WebView development
packages.

```bash
pnpm desktop:build:docker                      # deb, rpm, and AppImage
pnpm desktop:build:docker --bundles deb,rpm    # narrower bundle set
pnpm desktop:build:docker --platform linux/amd64
```

The first build downloads the Rust toolchain and crate sources and takes a
while; later builds reuse the Docker cache. The container is based on Debian 12,
so the bundles target Debian 12 and newer distributions. Docker cannot produce
macOS or Windows installers.

### On the host

For macOS and Windows, build on that operating system. The machine needs the
Rust toolchain and the WebView development packages for its operating system
(WebView2 on Windows, WebKitGTK on Linux, the system WebKit on macOS).

```bash
pnpm install
pnpm desktop:build       # installer for the current operating system
pnpm desktop:build:app   # app bundle only, no installer
pnpm desktop:dev         # development window with hot reload
```

Installers are unsigned for now, so the system may ask you to confirm the first
launch.

## Install from a build

On Linux, `pnpm desktop:install` installs the newest build for the current user
without root. It copies the app and its bundled adapter host into `~/.local`,
adds a menu entry and icons, and registers `clara://` links:

```bash
pnpm desktop:install            # install from this checkout
pnpm desktop:install --dry-run  # print the plan first
pnpm desktop:uninstall          # remove it again
```

The script installs an existing build only. It uses `dist/desktop` from the
Docker build first, then the output of a build made on this machine; run
`pnpm desktop:build:docker` or `pnpm desktop:build` first. If it reports that the
bundled adapter host is missing, rebuild so the sidecar is included. Use
`--from <dir>` to install another build and `--prefix <dir>` to install
somewhere other than `~/.local`.

Launch Clara from the application menu or with `clara-desktop`. Removing the app
keeps pairing and drafts; `pnpm desktop:uninstall --purge` removes those too.

Windows and macOS installers already install for the current user, so the script
does not handle them: open the `.exe` or `.dmg` from the build output.

## Pair the app

Pairing works the same way as the browser:

1. Open the hub panel and choose **Clients → Pair Client**.
2. Copy the pairing code.
3. Open Clara, paste the code on the connect screen, and connect.

`clara pair` prints a code too. A pairing link opens the web app, so paste
the code when you are using the desktop app. The QR button needs a camera that
the system webview exposes; pasting the code always works.

## Open the hub panel

The app includes the hub panel for the hub you are connected to. Choose **Hub**
in the app and sign in with the hub owner's username and password. You do not
need to open the hub's loopback address, and a remote hub works the same way
once the app is paired.

The panel shows hub health, paired harnesses, sessions, clients, traffic, and
settings in the same views as the hub host's own page. Adapter setup works from
the Harness view: the hub issues a one-time code and command, and the app's
adapter host can install on this computer, an SSH host, or a local Docker
container. A `clara://adapter` link opens that view with the code ready.

A few controls belong only to the hub host: **Go offline**, the local
connection switch that carries this app, and relay target or room changes. They
are disabled in the app because they would cut or redirect its own connection.
Use the hub's own panel for those.

### First run

- **A hub on this machine:** create the owner account once in the hub's own
  panel, then pair this app.
- **A remote hub:** the host creates the owner before pairing. The app cannot
  create the first owner over a remote connection.

## What is different

- The app has its own window, taskbar or dock icon, and install location.
- Links in messages open in your default browser instead of replacing Clara.
- There is no install prompt, service worker, offline shell, or update banner.
  To update, install a newer build. The reload control on the pairing screen
  reloads the bundled app; it cannot fetch a newer one.
- Web Push is not available. Inbox sounds and toasts work while the window is
  running; native desktop notifications are not part of this build yet.
- Pairing and drafts belong to the app installation. Removing the app removes
  them, so pair again after reinstalling.

Everything else, including end-to-end encryption, approval prompts, and cost
reporting, matches the web client.

To run the hub itself as a local service, see the [Hub CLI](hub-cli.md).
