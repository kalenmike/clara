---
title: Harness adapters
description: Pair a harness adapter with your Clara hub.
sidebar_position: 7
---

# Harness adapters

Clara reaches a harness through an adapter. The adapter runs on the harness
machine, connects out to the hub, and carries your sessions. The hub never opens
a port on the harness machine. This release includes the OpenCode and Claude Code
adapters; the hub and web client are harness-neutral.

| Harness     | Install                                        |
| ----------- | ---------------------------------------------- |
| OpenCode    | `clara-adapter-opencode install --pair <code>` |
| Claude Code | `clara-adapter-claude install --pair <code>`   |

Inside the Clara repository you can use
`pnpm clara adapter install --opencode --pair <code>` or
`pnpm clara adapter install --claude --pair <code>` instead.

## Pair an adapter

1. Sign in to the hub panel.
2. Open **Harness**, use **Add harness**, choose the adapter type and where the
   adapter runs (**Docker network** is the default; also **This machine** or
   **Cloudflare relay**), and select **Add harness**.
3. Copy the pairing code or the install command.
4. On the harness machine, run the adapter's own installer.
5. The installer looks for the harness and starts a user service, or a
   background process when systemd is not available. Return to the panel. A
   newly paired adapter shows **Paired · Offline** under **Paired harnesses**;
   when its session connects it becomes **Online**, appears under **Connected
   adapters**, and the first adapter becomes **Active**. If the Harness switch
   in the page header is off, the page shows **Off** instead of a live state.

Panel codes are only for the adapter installer. To pair this browser, use the
separate code or link printed by `pnpm clara pair`. A panel code starts with
`clara-harness1_`; a browser code starts with `clara1_`.

### OpenCode

If the installer cannot find OpenCode, it asks for the OpenCode URL, username,
and password, then retests before saving. The same command also installs the
Clara orchestration binding and the shared script runner. Use `--no-runner` to
skip the shared runner, or `--no-service` to write the config without installing
a user service.

### Claude Code

Install the adapter on the machine where Claude Code is installed and signed in.
The adapter uses the existing Claude Code login, so there is no harness password
to enter. If the machine uses an API key, start the adapter with
`ANTHROPIC_API_KEY` in its environment, or sign in with `claude auth login`
first.

The Claude Code installer accepts the same pairing flow. It installs only the
adapter and its user service; it does not install the Clara orchestration
binding. Use `--claude-path` to target a specific Claude Code binary, `--model`
to choose a default model, and `--permission-mode` to set how Claude asks for
approval. Approvals and clarifying questions appear in Clara while a session is
open.

If the panel shows **Paired · Offline**, start the adapter with:

```bash
clara-adapter-claude start
clara-adapter-claude logs
```

## Reinstall and reconnect

The adapter keeps a stable identity. If you uninstall and install it again, or
pair it again, it reconnects the same sessions and Clara metadata. Deleting the
connection keeps that state; use **Forget** only when you want to discard it.

## Troubleshooting

- **The harness is not found** — run the installer again. For OpenCode, enter the
  URL, username, and password; for Claude Code, install it on the machine and
  sign in with `claude auth login`.
- **Claude Code says it is not signed in** — sign in on the harness machine. The
  adapter does not store an API key.
- **The code expired** — create a new code in the panel.
- **The browser rejects a panel code** — panel codes install the adapter, not
  the browser. Run `pnpm clara pair`, then paste that link or code in Clara.
- **The adapter is offline** — **Paired harnesses** says **Paired · Offline**.
  Start the adapter service, then use **Test** in the panel. The hub keeps the
  connection and reconnects automatically. Clara stays connected and shows a
  harness banner with **Retry**.
- **The panel says Online but requests time out** — run
  `pnpm clara adapter status --claude` (or `--opencode`). The **hub** and
  **link** lines show whether the adapter has an authenticated session with the
  hub and how long ago it last heard from it; **health** shows the adapter's last
  harness check. If the process is running but the link is offline or stale,
  restart it with `pnpm clara adapter stop --claude` and
  `pnpm clara adapter start --claude`.
- **The Harness switch is off** — the page header and paired status say **Off**.
  Turn the switch on to proxy again; the adapter credential is kept while it is
  off.
- **The adapter was moved** — pair it again; the stable identity keeps the same
  sessions if the session directory moved with it.

For relay and container deployments, see [Remote access](self-hosting/relay.md)
and [Docker](self-hosting/docker.md). Clara does not ship a Claude Code
container image; install the adapter inside the container that runs Claude Code
and give it the Claude config directory and workspace mounts.
