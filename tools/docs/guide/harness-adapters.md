---
title: Harness adapters
description: Pair a harness adapter with your Clara hub.
sidebar_position: 7
---

# Harness adapters

Clara reaches a harness through an adapter. The adapter runs on the harness
machine, connects out to the hub, and carries your sessions. The hub never opens
a port on the harness machine. This release includes the OpenCode adapter; the
hub and web client are harness-neutral.

## Pair an adapter

1. Sign in to the hub panel.
2. Open **Harness**, use **Add harness**, choose the adapter type and where the
   adapter runs (**Docker network** is the default; also **This machine** or
   **Cloudflare relay**), and select **Add harness**. OpenCode is the only
   adapter type included with this release.
3. Copy the pairing code or the install command.
4. On the harness machine, run the adapter's own installer. For the included
   adapter:

   ```bash
   clara-adapter-opencode install --pair <code>
   ```

   Inside the Clara repository you can use
   `pnpm clara adapter install --opencode --pair <code>` instead.

5. The installer looks for the harness. For OpenCode, if it cannot find it,
   enter the OpenCode URL and password when asked.
6. The installer starts a user service, or a background process when systemd is
   not available. Return to the panel. A newly paired adapter shows
   **Paired · Offline** under **Paired harnesses**; when its session connects it
   becomes **Online**, appears under **Connected adapters**, and the first
   adapter becomes **Active**. If the Harness switch in the page header is off,
   the page shows **Off** instead of a live state.

Adapter codes are only for the installer. To pair a browser, use
**Clients → Pair a browser** in the panel, or the separate code or link printed
by `pnpm clara pair`. An adapter code starts with `clara-harness1_`; a browser
code starts with `clara1_`.

If the panel shows **Paired · Offline**, start it with:

```bash
clara-adapter-opencode start
clara-adapter-opencode logs
```

The same command also installs the Clara orchestration binding and the shared
script runner. Use `--no-runner` to skip the shared runner, or `--no-service` to
write the config without installing a user service.

## Reinstall and reconnect

The adapter keeps a stable identity. If you uninstall and install it again, or
pair it again, it reconnects the same sessions and Clara metadata. Deleting the
connection keeps that state; use **Forget** only when you want to discard it.

## Troubleshooting

- **The harness is not found** — run the installer again and enter the harness
  URL, username, and password. For OpenCode, the adapter retests before saving.
- **The code expired** — create a new code in the panel.
- **The browser rejects a panel code** — adapter codes install the adapter, not
  the browser. Use a browser code from **Clients → Pair a browser** or
  `pnpm clara pair`, then paste that link or code in Clara.
- **The adapter is offline** — **Paired harnesses** says **Paired · Offline**.
  Start the adapter service, then use **Test** in the panel. The hub keeps the connection
  and reconnects automatically. Clara stays connected and shows a harness
  banner with **Retry**.
- **The panel says Online but requests time out** — run
  `pnpm clara adapter status`. The **hub** and **link** lines show whether the
  adapter has an authenticated session with the hub and how long ago it last
  heard from it; **health** shows the adapter's last harness check. If the
  process is running but the link is offline or stale, restart it with
  `pnpm clara adapter stop --opencode` and `pnpm clara adapter start --opencode`.
- **The Harness switch is off** — the page header and paired status say **Off**.
  Turn the switch on to proxy again; the adapter credential is kept while it is
  off.
- **The adapter was moved** — pair it again; the stable identity keeps the same
  sessions if the session directory moved with it.

For relay and Docker deployments, see [Remote access](self-hosting/relay.md) and
[Docker](self-hosting/docker.md).
