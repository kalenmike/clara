---
title: Harness adapters
description: Pair the OpenCode adapter with your Clara hub.
sidebar_position: 7
---

# Harness adapters

Clara reaches OpenCode through an adapter. The adapter runs on the machine that
runs OpenCode, connects out to the hub, and carries your sessions. The hub never
opens a port on the OpenCode machine.

## Pair an adapter

1. Sign in to the hub panel.
2. Open **Harness adapters**, choose **OpenCode**, and select **Add harness**.
3. Copy the pairing code or the install command.
4. On the OpenCode machine, run:

   ```bash
   pnpm clara adapter install --opencode --pair <code>
   ```

5. The installer looks for OpenCode. If it cannot find it, enter the OpenCode
   URL and password when asked.
6. Return to the panel. The adapter appears online and becomes active.

The same command also installs the Clara orchestration binding. Use
`--no-daemon` to install only the binding or `--no-orchestration` to install
only the hub adapter.

## Reinstall and reconnect

The adapter keeps a stable identity. If you uninstall and install it again, or
pair it again, it reconnects the same sessions and Clara metadata. Deleting the
connection keeps that state; use **Forget** only when you want to discard it.

## Troubleshooting

- **OpenCode is not found** — run the installer again and enter the URL,
  username, and password. The adapter retests before saving.
- **The code expired** — create a new code in the panel.
- **The adapter is offline** — start the adapter service, then use **Test** in
  the panel. The hub keeps the connection and reconnects automatically.
- **The adapter was moved** — pair it again; the stable identity keeps the same
  sessions if the session directory moved with it.

For relay and Docker deployments, see [Remote access](self-hosting/relay.md) and
[Docker](self-hosting/docker.md).
