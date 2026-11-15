---
title: Headless server
description: Install the hub CLI as a service and create the owner from a CLI.
sidebar_position: 2.5
---

# Run the hub headless

The headless package contains the same hub service and embedded panel as the
Hub CLI. Use it on a server or in CI. Build the package on the operating system
you will run it on; the archive contains a compiled `clara-server` executable.

## Build

From a checkout on the target machine:

```bash
pnpm install
pnpm hub:headless
```

The archive is written under `dist/headless`, named for the platform and
architecture. Run the same command on macOS, Linux, and Windows to produce each
package. A Linux machine cannot build the macOS or Windows executables.

## Install

Extract the archive and run the install helper:

- Linux: `./install.sh` installs a systemd user unit and starts it.
- macOS: `./install.sh` installs a LaunchAgent and starts it.
- Windows: `powershell -ExecutionPolicy Bypass -File .\install.ps1` registers a
  task at sign-in and starts it.

Or run it in the foreground:

```bash
./clara-server serve
```

## First run

The panel listens on `http://127.0.0.1:8790/`. Until the owner account exists,
the hub starts only that panel. Create the account in the panel, or from the
command line:

```bash
./clara-server setup --username admin --password-stdin
```

The Setup modal then asks for the connection path. Choose **Local only** or set
up the relay with an HTTPS Web URL, pair a harness, and pair a client. It can be
dismissed and resumed from **Settings → Setup**.

For an unattended install, set `CLARA_ADMIN_USERNAME` and
`CLARA_ADMIN_PASSWORD` or `CLARA_ADMIN_PASSWORD_FILE` before starting it.

The panel stays on loopback. Do not publish it to the internet; use the relay
for remote clients and pair devices from the panel.

## Data

The defaults are:

- `~/.config/clara` for configuration, reset tokens, and keys.
- `~/.local/share/clara` for the database and logs.

Set `CLARA_CONFIG_DIR` and `CLARA_DATA_DIR` to move them.

## Update

Stop the service, replace the executable, and start it again. The database
migrations run on startup.
