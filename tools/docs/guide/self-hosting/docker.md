---
title: Docker
description: Run the hub, web client, and optional orchestration with Compose.
sidebar_position: 1
---

# Run Clara with Docker

Docker is the default target for `pnpm clara`. It creates one external network
called `clara` and runs the hub, web client, and optionally the orchestration
service as containers.

## Requirements

- Docker with the Compose plugin.
- An OpenCode 2.1.x server. It can run on the host or in another container.
- A checkout of the repository.

## First run

```bash
pnpm install
pnpm clara start --build
```

The first start creates the `clara` network, bootstraps `infra/docker/.env`, and
starts the selected services. Upgrading from an older checkout: move
`docker/.env` to `infra/docker/.env`; the CLI keeps reading the old location
until you do. Start checks the effective env file and shell values first: a relay
URL without both relay tokens, or a bind directory that is not absolute, stops
the command with the variable name instead of leaving a container restarting. If
a service still does not become healthy, the command prints its recent log
lines. Then set up the panel:

```bash
pnpm clara server setup-token
pnpm clara server panel
```

In the panel:

1. Choose the superadmin password.
2. Open **Harness**, enter the OpenCode connection, and test it.
3. Save and activate the connection.
4. Set **Web URL** if the default `http://127.0.0.1:8080` is not what devices
   should open.

Inside a container, `127.0.0.1` means the hub container itself. Use a name that
is reachable on the `clara` network, for example `http://opencode:4096`.

## Pair a device

```bash
pnpm clara pair
```

Open the printed link on the device. Use `pnpm clara pair --no-relay` for a
same-machine code. For a phone or another network, configure the relay first;
see [Remote access](relay.md).

## Services and ports

| Service       | Container            | Host port                                                |
| ------------- | -------------------- | -------------------------------------------------------- |
| Web client    | `clara-web`          | `127.0.0.1:8080`                                         |
| Hub service   | `clara-server`       | panel `127.0.0.1:8790`, local WebSocket `127.0.0.1:8788` |
| Orchestration | `clara-orchestrator` | `127.0.0.1:8789`                                         |

## Everyday commands

```bash
pnpm clara status
pnpm clara logs server
pnpm clara logs web
pnpm clara restart --build
pnpm clara stop
```

`status` accepts `--json` for scripts. `logs` follows one service. The scoped
commands `pnpm clara server …`, `pnpm clara web …`, and
`pnpm clara orchestrator …` work when you want only one service.

`stop` reads `infra/docker/.env` itself. You do not need to export the orchestrator
token or workspace in your shell before stopping the stack.

## Data

The stack keeps state in Docker volumes:

- `clara-server-config` — hub configuration, secrets, and setup token.
- `clara-server-data` — the hub SQLite database and orchestration data.
- `clara-orchestrator-data` — orchestration state.

Back up and restore the volumes while the stack is stopped:

```bash
pnpm clara stop
pnpm clara backup --output ~/clara-backup.tar.gz
pnpm clara restore ~/clara-backup.tar.gz
```

To bind the volumes to host paths, set `CLARA_SERVER_CONFIG_DIR`,
`CLARA_SERVER_DATA_DIR`, or `CLARA_ORCHESTRATOR_DATA_DIR`. See
[Configuration](configuration.md).

## Update

```bash
pnpm clara rebuild
```

The rebuild captures the running services, installs dependencies, builds, and
restarts only what was running. To update a single container with a fresh image,
use `pnpm clara restart --build`.

## Related

- [Configuration](configuration.md)
- [Updates and backups](updates.md)
- [Troubleshooting](../troubleshooting.md)
