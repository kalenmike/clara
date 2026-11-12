---
title: Local install
description: Run the hub and web client as Node processes on the host.
sidebar_position: 2
---

# Run Clara locally

The local target runs the hub service and web client as detached Node processes.
It is the fastest path when Node and the harness already run on the machine.

## Requirements

- Node 22 (`.nvmrc`).
- pnpm 11.
- A running harness and its adapter. This release includes the OpenCode 2.1.x
  adapter.

## First run

```bash
pnpm install
pnpm clara start --local --build
pnpm clara server setup-token --local
pnpm clara server panel
```

In the panel:

1. Choose the superadmin password.
2. Add a harness under **Harness**, then run the printed adapter install command
   on the harness machine. For OpenCode, the installer finds the server or
   prompts for its URL and password.
3. Wait for the adapter to show **Online** under **Paired harnesses**, then use
   **Test** and **Activate**.
4. Set **Web URL** if devices should open something other than
   `http://127.0.0.1:8080`.

Then pair:

```bash
pnpm clara pair --local --no-relay
```

Open the printed link, or open `http://127.0.0.1:8080` and paste the code.

## Services and ports

| Service             | Default          |
| ------------------- | ---------------- |
| Web client          | `127.0.0.1:8080` |
| Hub panel           | `127.0.0.1:8790` |
| Hub local WebSocket | `127.0.0.1:8788` |
| Orchestration       | `127.0.0.1:8789` |

## Everyday commands

```bash
pnpm clara status --local
pnpm clara logs server --local
pnpm clara restart --local --build
pnpm clara stop --local
```

Local processes keep a PID and log under `~/.local/share/clara`, so the same
stop, restart, status, and logs commands work without Docker.

## Data

- `~/.config/clara` — configuration, setup token, secrets, and VAPID keys.
- `~/.local/share/clara` — SQLite database, logs, and orchestration data.

Set `CLARA_CONFIG_DIR` and `CLARA_DATA_DIR` to move them. See
[Configuration](configuration.md).

## Update

```bash
pnpm clara rebuild
```

The rebuild installs dependencies, builds the checkout, restarts only the
services that were running, and verifies their health. For a quick restart after
pulling changes, use `pnpm clara restart --local --build`.

## Run it as a service

The repository includes a systemd unit at `clara.service` and an
`install-service.sh` helper. Run the helper from the checkout to install the unit
for the current user. Confirm the paths inside the unit before enabling it if your
checkout is not at the same location.

## Development mode

For front-end work, use `pnpm dev`. It starts the web app on `127.0.0.1:5173` and
the hub service on `127.0.0.1:8788`. The built panel is served by the hub
service; for panel development, run `pnpm dev:panel` on `127.0.0.1:5174`.

## Related

- [Configuration](configuration.md)
- [Updates and backups](updates.md)
- [Troubleshooting](../troubleshooting.md)
