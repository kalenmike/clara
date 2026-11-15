---
title: Docker
description: Run the hub, web client, and optional orchestration with Compose.
sidebar_position: 1
---

# Run Clara with Docker

Docker is the default target for `clara`. It creates one external network
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
clara start --build
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
clara status hub --open
```

The first run shows **Create the hub owner account**. Choose the username and
password. The hub starts no transports until the account exists. For an
unattended container, create it without a browser:

```bash
docker exec clara-server /app/clara-server setup --password-stdin
```

Or set `CLARA_ADMIN_USERNAME` and `CLARA_ADMIN_PASSWORD` (or
`CLARA_ADMIN_PASSWORD_FILE`) in the environment before starting the container.

In the panel:

1. Create the owner account.
2. Choose **Local only** or set up the relay in the Setup modal. The relay path
   needs an online relay and an HTTPS Web URL.
3. Pair a harness in the same modal and copy the install command. The hub never
   runs installs; run the command on the harness machine (or inside its
   container). Clara Desktop can install it in one click on a laptop or over SSH
   to a VPS.
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
clara pair
```

Use **Local** in the panel, or `clara pair --no-relay`, for
a same-machine code. For a phone or another network, configure the relay first;
see [Remote access](relay.md).

## Services and ports

| Service       | Container      | Host port                                                |
| ------------- | -------------- | -------------------------------------------------------- |
| Web client    | `clara-web`    | `127.0.0.1:8080`                                         |
| Hub service   | `clara-server` | panel `127.0.0.1:8790`, local WebSocket `127.0.0.1:8788` |
| Orchestration | `clara-engine` | `127.0.0.1:8789`                                         |

## Everyday commands

```bash
clara status
clara logs hub
clara logs web
clara restart --build
clara stop
```

`status` accepts `--json` for scripts. `logs` follows the selected target.
Use `clara start hub`, `clara start web`, or
`clara start engine` when you want only one service.

`stop` reads `infra/docker/.env` itself. You do not need to export the engine
token or workspace in your shell before stopping the stack.

## Data

The stack keeps state in Docker volumes:

- `clara-server-config` — hub configuration, secrets, and reset tokens.
- `clara-server-data` — the hub SQLite database and orchestration data.
- `clara-orchestrator-data` — engine state.

Back up and restore the volumes while the stack is stopped:

```bash
clara stop
clara backup --output ~/clara-backup.tar.gz
clara restore ~/clara-backup.tar.gz
```

To bind the volumes to host paths, set `CLARA_SERVER_CONFIG_DIR`,
`CLARA_SERVER_DATA_DIR`, or `CLARA_ORCHESTRATOR_DATA_DIR`. The hub container
runs as UID/GID 1000, so the host directories for its config and data must be
writable by that ID. See [Configuration](configuration.md).

## Update

```bash
clara rebuild
```

The rebuild captures the running services, installs dependencies, builds, and
restarts only what was running. To update a single container with a fresh image,
use `clara restart --build`.

## Related

- [Configuration](configuration.md)
- [Updates and backups](updates.md)
- [Troubleshooting](../troubleshooting.md)
