# Clara

> [!WARNING]
> **Clara is a work in progress.** Install paths, APIs, and interfaces may
> change. Run it with a hub and harness you control, and expect rough edges.

Clara is a browser, home-screen, and desktop client for agent harnesses. It lets
you browse projects, start and steer sessions, approve tool calls, and watch
usage from another device. A small **hub** on your machine carries the connection
to a paired **adapter**, which owns the harness connection and keeps the harness
password on its own host. Traffic is end-to-end encrypted, over a local WebSocket
or the optional Cloudflare relay.

The included adapters target OpenCode 2.1.x, Claude Code 2.1.325, and Pi 1.5.x.

## Install

```bash
curl -fsSL https://clara.kalenmichael.com/install | sh
```

The installer detects your platform, verifies the signed release manifest and
archive checksum, and installs the `clara` command. On macOS, and on Linux and
Windows with a desktop session, it also installs Clara Desktop. Use
`--no-desktop` for a terminal-only install:

```bash
curl -fsSL https://clara.kalenmichael.com/install | sh -s -- --no-desktop
```

On Windows, use PowerShell:

```powershell
irm https://clara.kalenmichael.com/install.ps1 | iex
```

See [Install the Clara command](tools/docs/guide/get-clara.md) for the Windows
flags, direct release downloads, and signature details.

### What you need

- A machine to run the hub and the `clara` command.
- A harness machine with one of the included adapters, or your own adapter.
- A browser, installed PWA, or Clara Desktop.
- Optional: a Cloudflare account and domain if devices connect from outside your
  network.

## Set up

```bash
clara setup
clara status hub --open
```

Setup creates the hub owner account, starts the hub, engine, and web client, and
offers to install a per-user login service. In the hub panel, pair a harness,
then pair the browser or desktop client you want to use. You can dismiss the
Setup modal and return from **Settings → Setup**.

For a terminal pairing code instead:

```bash
clara pair hub
```

Self-hosting details, relay setup, and headless installs are in the
[self-hosting guide](tools/docs/guide/self-hosting/index.md).

## Everyday commands

| Command                        | What it does                              |
| ------------------------------ | ----------------------------------------- |
| `clara start` / `clara stop`   | Start or stop the local stack             |
| `clara status`                 | Show service health and versions          |
| `clara logs -f`                | Follow every service log                  |
| `clara pair hub`               | Print a browser pairing code              |
| `clara adapter install <kind>` | Install and pair a harness adapter        |
| `clara desktop install`        | Install or update Clara Desktop           |
| `clara update`                 | Verify and install a newer signed release |

`clara doctor` prints paths, versions, login service state, and the installed
desktop version.

## What Clara does

- Projects and sessions across every paired harness, with an inbox for work that
  needs you.
- Streaming chat, tool calls, approvals, questions, and plan handoff.
- Model selection, token usage, and cost.
- One-click adapter setup from the hub panel or Clara Desktop.
- Local-only or relay connections with E2EE, per-device keys, and revocation.
- Clara Desktop with native notifications, plus optional orchestration and Clara
  Lab.

## Documentation

- [User guide](tools/docs/guide/index.md) — pairing, sessions, chat, settings,
  notifications, and desktop.
- [Install and self-host](tools/docs/guide/self-hosting/index.md) — the hub,
  adapters, relay, backups, and updates.
- [Internal documentation](docs/README.md) — architecture, feature specs, and
  development.
- [Shipped scope](docs/features/capabilities.md) — what is implemented, partial,
  or missing.
- [AGENTS.md](AGENTS.md) — the repository contract for coding agents.

Run the documentation site locally with `pnpm docs`; it serves the user guide at
`/guide/` and the internal docs at `/internals/`.

## Work on Clara

Clara is a pnpm workspace on Node 22, with Bun 1.4+ for the packaged command and
Tauri/Rust for the desktop shell.

```bash
pnpm task session start my-change
pnpm check
pnpm build
pnpm task session close my-change
```

Work happens in a task worktree under `../clara-worktrees`. The full workflow,
workspace layout, release commands, and tooling live in
[docs/development.md](docs/development.md). Agent-specific rules are in
[AGENTS.md](AGENTS.md).
