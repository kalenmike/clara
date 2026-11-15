---
title: Install the Clara command
description: Install Clara as one signed command and run the stack without Docker.
sidebar_position: 9.5
---

# Install the Clara command

The packaged `clara` command runs the hub, the panel, the engine, and the web
client from one executable. It is the fastest way to run Clara on a machine you
own. Docker and the checkout workflows still work.

## Install

Download the archive for your platform from the latest Clara release and put
`clara` somewhere on your `PATH`. The release also publishes an installer that
verifies the signed release manifest and the archive checksum:

```bash
curl -fsSL https://github.com/kalenmike/clara/releases/latest/download/install.sh | sh
```

On Windows, download `install.ps1` from the same release and run it in
PowerShell. The installer puts `clara` in your user bin directory and adds it to
your `PATH` when it is missing.

## Set up

```bash
clara setup
```

Setup asks for the hub owner username and password, creates the Clara
directories, starts the engine, hub, and web client, and offers to install a
per-user login service so the stack starts when you sign in. It prints the panel
and web addresses when it is done.

For an unattended install:

```bash
printf '%s\n' "$CLARA_PASSWORD" | clara setup --non-interactive --username admin --password-stdin
```

Re-running setup repairs missing pieces without duplicating them.

## Everyday commands

```bash
clara ps                 # what is running, with version, protocol, and uptime
clara logs -f            # follow every service
clara logs hub -f        # follow one service
clara pair hub           # print a browser pairing code and QR
clara restart            # restart the stack
clara stop               # stop the stack
clara doctor             # paths, versions, ports, and login service
```

`clara status` asks each running service which version and protocol it loaded,
so a stack that is still on the previous build after an update is visible before
you restart it. A build from a checkout reports its commit as well, such as
`0.1.0-dev+abc1234`, so the exact local build is visible. A value marked with `*`
differs from the installed command; a service that does not report one shows `-`.
`clara status --json` is the machine-readable form for scripts. Colors and the
spinner are disabled automatically when the output is not a terminal.

`clara stop` stops every service within a bounded window and names any service
that refused to stop; run it again to retry the pids it kept. An interrupted
stop never becomes a second stack on the same ports — the next `clara start`
cleans up first.

## Pair a harness

Adapters are downloaded when you ask for them; none ship in the command.

```bash
clara adapter search                 # kinds, latest version, size, platforms
clara adapter list                   # what is installed on this machine
clara adapter install opencode       # pull, verify, install, pair, and start
clara adapter install claude --pair ABC-123
clara adapter remove pi --purge
```

The hub still prints a copy command for adapters you install on another machine.

## Run adapters only

A machine can carry a harness adapter without running the Clara services. Get a
pairing code on the hub host, then install the adapter here:

```bash
clara adapter install opencode --pair <code>
```

`clara status` recognizes the adapter-only machine, shows the hub's reported web,
hub, and engine endpoints, and lists the local adapters. `clara status --open`
opens the hub's web client when an adapter has reported it.

The service commands stay on the hub host. `clara start`, `clara stop`,
`clara restart`, `clara logs`, and `clara pair` refuse here and explain where to
run them. `clara setup` is the explicit way to create a hub on this machine as
well. Adapter search, install, start, stop, logs, and upgrades remain local.

## Run scripts

The shared runner is part of the command; it does not need a separate download.

```bash
clara runner start --workspace ~/src/clara
clara runner status
clara runner logs -f
clara runner stop
```

The runner connects to the local engine and executes pipeline scripts in the
workspace you name.

## Update

```bash
clara update --check     # current and latest version
clara update             # verify and install the newer release
clara update --rollback  # return to the previous version
```

Updates verify an Ed25519 signature over the release manifest and the archive
checksum before replacing anything. The running stack restarts on the new
version.

## Autostart

`clara setup` offers to install a login service. You can manage it later:

```bash
clara service status
clara service install
clara service uninstall
clara service print      # show the unit for a host without a supported manager
```

The login service is always per-user and never needs administrator rights. On
Linux it uses `systemd --user` when available and falls back to XDG autostart for
desktop sessions. macOS uses a LaunchAgent and Windows uses a logon task.

## Remove Clara

```bash
clara uninstall            # stop, remove autostart, remove downloaded versions
clara uninstall --purge    # also remove config, data, and cache
```

## Related

- [Self-hosting overview](self-hosting/index.md)
- [Configuration](self-hosting/configuration.md)
- [Harness adapters](harness-adapters.md)
- [Remote access](self-hosting/relay.md)
