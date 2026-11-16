# Harness adapters

## Summary

Clara reaches a harness through an adapter daemon on the harness machine. It
connects out over the same local or relay WebSocket and E2EE session as a
browser client, then speaks the Clara Harness Protocol. The hub routes typed
`/v1` calls to the owning adapter by capability, not harness kind.

| Included adapter          | Harness             | Install                                        |
| ------------------------- | ------------------- | ---------------------------------------------- |
| `@clara/adapter-opencode` | OpenCode 2.1.x      | `clara-adapter-opencode install --pair <code>` |
| `@clara/adapter-claude`   | Claude Code 2.1.325 | `clara-adapter-claude install --pair <code>`   |
| `@clara/adapter-pi`       | Pi 1.5.x            | `clara-adapter-pi install --pair <code>`       |

## User flow

1. In the panel's **Harness** view, choose **Pair Harness**, then the harness.
2. The hub returns a one-time code, an install command, and a `clara://adapter`
   link; it never runs the install. Adapter codes start with `clara-harness1_`,
   while a browser uses a `clara1_` code from **Clients → Pair Client**.
3. Answer **Remote** or **Local**, then host or Docker container; Direct needs a
   reachable address.
4. A browser user runs the command on the harness machine. Clara Desktop adds
   **This computer**, an **SSH host**, and a local **Docker container**.
5. The script verifies and installs the archive, runs the installer, starts the
   adapter, and waits for an authenticated hub link.
6. The installer discovers the harness: OpenCode from flags/env/`service.json`,
   Claude Code from the machine's login, and Pi from the installed `pi` binary.
7. The adapter enrolls, stores its credential, and starts a service or background
   process. The panel shows **Connected** only after an authenticated link; a
   failed start prints the adapter state and log in the install card.
8. Open the web client; sessions and Clara projects arrive through the adapter.
9. A newer release shows **Update** on the paired harness row. The adapter
   pulls, verifies, restarts, and reconnects; older installs get a repair command.

## Core business rules

1. The adapter connects out; the hub never dials an adapter port. Local, Docker,
   and relay are transport values, not architectures. Direct access is a hub
   setting: [panel/network.md](panel/network.md).
2. Adapter pairing uses the same one-time code, fingerprint, expiry, E2EE
   handshake, replay guard, and revocation as browser pairing; a relay code
   carries a ten-minute enrollment grant, then a thirty-day refreshed grant.
3. Included installers place different pieces, all with `--pair <code>`: OpenCode installs the daemon, its binding,
   and shared-runner config; Claude Code and Pi install only the daemon and a user service. `--no-runner`, `--no-service`,
   and `--from <path>` select those pieces or a checkout build. The binding registers the policy plugin in the OpenCode
   config, so a running server reloads it and its Clara tools without a restart; the install warns when it is not loaded.
4. On the target the adapter discovers and authenticates the harness, keeps its
   password in `config.json`, translates traffic into Clara frames, and samples
   its machine for `host.metrics`. The hub never holds the password.
5. A stable harness identity means reinstall, re-pair, and connection deletion
   reconnect the same sessions and Clara project metadata; **Forget** purges
   that metadata explicitly.
6. The hub owns Clara metadata: adapters return harness-native data and never
   store snooze, archive, view, or project settings. Archive, unarchive, and
   delete are capability-gated per harness; OpenCode maps them to bulk session
   actions, while Claude Code and Pi report unsupported and Clara applies its
   own state. A harness bump changes only that adapter.
7. Adapters are pulled, never shipped. The hub embeds no artifact and runs no
   install script; it verifies the manifest and returns its digest and command.
   Adapter setup stays off until enabled in **Network → Adapter setup**. A
   connected adapter may be told to update, but it pulls and verifies the
   release from its own recorded registry.
8. Pi runs the user's own `pi` binary over `pi --mode rpc`, never the SDK, so
   Clara follows its version, auth, `models.json`, extensions, skills, packages,
   MCP servers, and project trust. It has one built-in agent, no session move,
   and no session lock; extension dialogs become Clara forms.
9. A container-backed record describes an adapter already running in Docker. The
   install reads its version and pairing inside the container and writes an
   `adapters.json` record with no host path or pid, so lifecycle commands address
   the container. Upgrade asks for an image rebuild; remove keeps its volumes.
10. The adapter reports its hostname, platform, architecture, and container
    state; the hub keeps the latest report and the pairing's install path, so
    identical harness kinds stay distinguishable. It rereads `/info` on every
    authenticated session, so a restart refreshes versions and capabilities.
11. An adapter updates only itself: it pins its registry in `install.json`,
    verifies a strictly newer artifact, extracts a new version directory, and
    hands the restart to a detached supervisor that reinstalls with the saved
    pairing and restores the old version if the new one does not authenticate.
12. A standalone install writes the host record and launcher and can download the signed CLI.

## Edge cases

- **Harness not reachable** — OpenCode prompts for URL and credentials, then
  retests; Claude Code reports a missing binary or signed-out machine.
- **Wrong or stale code** — an expired, used, or wrong-kind code is rejected and
  the web points to the harness machine or **Clients → Pair Client**.
- **Adapter offline** — the panel shows **Paired · Offline**, `/v1` returns
  `harness_offline`, and the adapter reconnects with backoff; an install that
  leaves no authenticated process fails with its state and log.
- **Harness access off** — cards show **Off**; the hub stops proxying until enabled.
- **Adapter setup off or registry unreachable** — the panel cannot read the
  manifest or issue a code and names the error; checkout commands still work.
- **Adapter behind the registry** — the paired-harness row offers **Update**;
  an adapter without recorded provenance, a container, or a failed update names
  a no-CLI repair command. The hub never downloads or runs the artifact.
- **Container-backed adapter** — `--pair` refuses a stopped container; upgrade
  needs an image rebuild; `verify --directory` reads inside it.
- **SSH alias missing or key locked** — the alias is rejected, and installs use
  key or agent auth only, so unlock the key first.
- **Checksum mismatch or unsupported target** — the script and archive digests
  are verified, and an unknown platform stops before anything runs.
- **Relay grant expired** — `401`; the adapter stops and reports the reinstall.

## Out of scope

- Running the adapter inside the hub process or opening an inbound adapter port.
- A direct public `wss://` hub endpoint, a hub-wide default harness, or one
  active adapter per hub.
- One-click installs into a remote Docker host; copy or SSH the command.
- A Claude Code or Pi orchestration binding, shared-runner integration, or a
  shipped container image.
- Attaching to an already-running Pi TUI process; Pi exposes no attach API.

## Known gaps

- Claude Code subagent sessions are not separate Clara sessions, and subagent
  definitions are read-only; it keeps no per-step cost and one API backend per
  process.
- Pi exposes no session lock or move: concurrent writes create branches, and a
  session is bound to its working directory.
- A Pi extension confirmation maps to a permission card, but **Always** behaves
  as **Once** because the extension owns the policy.

## Technical appendix

<details>
<summary>Commands, data, and references</summary>

- Config: `<config>/clara/adapters/<kind>/config.json`; data:
  `<data>/clara/adapters/<kind>/{identity.json,adapter.log,adapter.pid,state.json,
update.json,update.log}`. Claude keeps `catalog.json`; Pi keeps `prompt-ids.json`.
- Commands: `clara-adapter-<kind> install --pair <code>` (plus `--no-service`,
  `--no-runner`), `clara-adapter-<kind> upgrade [--check]`, and
  `clara-adapter-<kind> clara <command…>`. Hub-facing:
  `clara adapter install|list|status|start|stop|logs|verify|upgrade|remove <kind>`.
  The panel update posts to `/harness/v1/maintenance/update`; the hidden
  `apply-update --plan <path>` supervisor performs the switch.
- Registry: `<registry>/<kind>/manifest.json` and `v<version>-install.sh`;
  `CLARA_ADAPTER_REGISTRY_URL` overrides. `pnpm adapters:build` and
  `pnpm adapters:serve` provide a local registry. The panel waits for an
  authenticated `state.json` before reporting success.
- Protocol frames, capabilities, and limits:
  [harness-protocol.md](../architecture/harness-protocol.md). Identity:
  [E2EE](../architecture/e2ee.md). Routing: [overview](../architecture/overview.md).
  Client pairing: [connection.md](connection.md). Panel:
  [panel/access.md](panel/access.md).

</details>
