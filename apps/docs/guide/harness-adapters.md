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
2. Open **Harness adapters**, choose **OpenCode**, choose where the adapter
   runs (**Docker network** is the default; also **This machine** or **Cloudflare
   relay**), and select **Add harness**.
3. Copy the pairing code or the install command.
4. On the OpenCode machine, run:

   ```bash
   pnpm clara adapter install --opencode --pair <code>
   ```

5. The installer looks for OpenCode. If it cannot find it, enter the OpenCode
   URL and password when asked.
6. The installer starts a user service, or a background process when systemd is
   not available. Return to the panel. A newly paired adapter shows
   **Paired · Offline**; it becomes **Online** when its session connects, and
   the first adapter becomes **Active**. If the Harness switch is off, the card
   shows **Off** instead of a live state.

Panel codes are only for the adapter installer. To pair this browser, use the
separate code or link printed by `pnpm clara pair`. A panel code starts with
`clara-harness1_`; a browser code starts with `clara1_`.

If the panel shows **Paired · Offline**, start it with:

```bash
pnpm clara adapter start --opencode
pnpm clara adapter logs --opencode
```

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
- **The browser rejects a panel code** — panel codes install the adapter, not
  the browser. Run `pnpm clara pair`, then paste that link or code in Clara.
- **The adapter is offline** — the card says **Paired · Offline**. Start the
  adapter service, then use **Test** in the panel. The hub keeps the connection
  and reconnects automatically. Clara stays connected and shows a harness
  banner with **Retry**.
- **The Harness switch is off** — the card says **Off**. Turn the switch on to
  proxy again; the adapter credential is kept while it is off.
- **The adapter was moved** — pair it again; the stable identity keeps the same
  sessions if the session directory moved with it.

For relay and Docker deployments, see [Remote access](self-hosting/relay.md) and
[Docker](self-hosting/docker.md).
