---
title: Docker
description: Run the hub, web client, and optional orchestration with Compose.
sidebar_position: 1
---

# Run Clara with Docker

Docker is the default target for `pnpm clara`. It creates one external network
called `clara` and runs the hub, web client, and optionally the orchestration
service as containers. The hub container is the Bun sidecar with the panel
embedded; `infra/docker/server-node.Dockerfile` keeps the previous Node image
as a fallback.

## Requirements

- Docker with the Compose plugin.
- A running harness and its adapter. This release includes the OpenCode 2.1.x
  adapter. The harness can run on the host or in another container.
- A checkout of the repository.

## First run

```bash
pnpm install
pnpm clara start --build
```

The first start creates the `clara` network, bootstraps `infra/docker/.env`, and
starts the selected services. Upgrading from an older checkout: move
`docker/.env` to `infra/docker/.env`; the CLI keeps reading the old location
until you do. Start checks the effective env file and shell values first: a bind
directory that is not absolute stops the command with the variable name, and a
relay URL without environment tokens warns because the panel may already have
saved them. If a service still does not become healthy, the command prints its
recent log lines. Then open the panel:

```bash
pnpm clara server panel
```

The first run shows **Create the hub owner account**. Choose the username and
password. The hub starts no transports until the account exists. For an
unattended container, create it without a browser:

```bash
pnpm clara server setup --password-stdin
```

Or set `CLARA_ADMIN_USERNAME` and `CLARA_ADMIN_PASSWORD` (or
`CLARA_ADMIN_PASSWORD_FILE`) in the environment before starting the container.

In the panel:

1. Create the owner account.
2. Choose **Local only** or set up the relay in the Setup modal. The relay path
   needs an online relay and an HTTPS Web URL.
3. Pair a harness in the same modal. Choose **Local → Docker container**, copy
   the command, and run it inside the harness container. A hub running in Docker
   cannot run adapter installs itself, so the panel issues the container-target
   code instead.
4. Pair a client from the modal. You can dismiss it and resume from
   **Settings → Setup**.
5. Set **Web URL** if the default `http://127.0.0.1:8080` is not what devices
   should open.

Inside a container, `127.0.0.1` means that container. An adapter container joins
the `clara` network and reaches the hub at `ws://server:8788/ws`; for a
containerized harness, use a service name such as `http://opencode:4096`.

## Pair a device

Open **Clients → Pair Client** in the hub panel and scan the QR or open the
link on the device. You can also run:

```bash
pnpm clara pair
```

Use **Local** in the panel, or `pnpm clara pair --no-relay`, for
a same-machine code. For a phone or another network, configure the relay first;
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

- `clara-server-config` — hub configuration, secrets, and reset tokens.
- `clara-server-data` — the hub SQLite database and orchestration data.
- `clara-orchestrator-data` — orchestration state.

Back up and restore the volumes while the stack is stopped:

```bash
pnpm clara stop
pnpm clara backup --output ~/clara-backup.tar.gz
pnpm clara restore ~/clara-backup.tar.gz
```

To bind the volumes to host paths, set `CLARA_SERVER_CONFIG_DIR`,
`CLARA_SERVER_DATA_DIR`, or `CLARA_ORCHESTRATOR_DATA_DIR`. The hub container
runs as UID/GID 1000, so the host directories for its config and data must be
writable by that ID. See [Configuration](configuration.md).

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
