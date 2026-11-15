# Harness adapters

## Summary

Clara reaches a harness through a small adapter daemon. The adapter connects out
to the hub over the same local or relay WebSocket and E2EE session as a browser
client, then speaks the Clara Harness Protocol. The hub is harness-neutral: it
routes typed `/v1` calls to the adapter that owns the workspace or session, and
branches on capability flags, not harness kind. Every paired adapter is a peer;
there is no hub-wide default. This repository includes the OpenCode,
Claude Code, and Pi adapters. Additional adapters can use the same pairing,
transport, and capability model.

| Included adapter          | Harness             | Install                                        |
| ------------------------- | ------------------- | ---------------------------------------------- |
| `@clara/adapter-opencode` | OpenCode 2.1.x      | `clara-adapter-opencode install --pair <code>` |
| `@clara/adapter-claude`   | Claude Code 2.1.325 | `clara-adapter-claude install --pair <code>`   |
| `@clara/adapter-pi`       | Pi 1.5.x            | `clara-adapter-pi install --pair <code>`       |

The adapter, not the hub, discovers and authenticates the harness. The hub never
contacts the harness directly.

## User flow

1. Open the hub panel's **Harness** view and choose **Pair Harness**. Choose
   OpenCode, Claude Code, or Pi.
2. The hub fetches the adapter manifest from the configured registry and returns
   a one-time code, a one-line install command, and a `clara://adapter` link. It
   never runs the install. Adapter codes start with `clara-harness1_` and only
   install an adapter; a browser pairs with a `clara1_` code from **Clients →
   Pair Client** or `clara pair`.
3. Answer **Remote** or **Local** and, for a local harness, whether the adapter
   runs on the host or in a Docker container. Relay and Direct are both always
   available: the panel suggests one from the selected placement but never
   disables the other. A direct pairing needs an address the target can reach.
   The hub reports its loopback, Docker bridge, and LAN addresses, and Clara
   Desktop also reads the selected container's Docker gateway. A local host uses
   loopback; a local container uses the Docker bridge; a remote machine uses a
   LAN address, a tunnel, or the relay. Direct access is a hub setting, not a
   property of the harness: **loopback**, **docker** (loopback plus bridge
   addresses), **lan** (all interfaces), or **custom**. It is editable from the
   panel's Network view and from `CLARA_LOCAL_ACCESS`.
4. A browser-only user copies the command and runs it on the machine that hosts
   the harness. Clara Desktop adds a one-click path: the bundled panel's adapter
   host accepts **This computer**, an **SSH host** from the laptop's
   `~/.ssh/config` or a typed user/host/port, and a local **Docker container**,
   and runs the same checksummed script. The hub host never needs SSH keys,
   Docker access, or a route to the harness machine.
5. The install script detects the target platform, downloads the matching
   Bun-compiled adapter archive, verifies its SHA-256, installs it under the
   adapter data directory, and runs the adapter installer. The manual commands
   are `clara adapter install opencode --pair <code>`,
   `clara adapter install claude --pair <code>`, and
   `clara adapter install pi --pair <code>`.
6. The OpenCode installer discovers OpenCode from flags, environment, or
   `~/.local/state/opencode/service.json`. The Claude Code installer uses the
   machine's existing Claude Code login and accepts `--claude-path`, `--model`,
   and `--permission-mode`. It never stores an API key. The Pi installer uses
   the machine's installed `pi` binary in RPC mode.
7. The adapter enrolls and stores its credential. The installer then starts a
   user service, or a background adapter process when systemd/launchd is not
   available. The pairing card shows **Waiting for the adapter to connect…**
   and switches to **Connected** when the adapter registers; closing before
   enrollment cancels the code. The panel shows **Paired · Offline** under
   **Paired harnesses** until the adapter connects; it then shows **Online** and
   adds a live row under **Connected adapters**. The first adapter is
   **Active**; turning the Harness switch off shows **Off** while the adapter
   credential is kept.
8. Open the web client. Sessions arrive through the adapter; Clara projects are
   created in the web client and their workspaces link directories on the
   adapter. The hub never contacts the harness.

## Core business rules

1. The adapter connects out; the hub does not connect to an adapter port.
   Local, Docker, and relay are transport values in the pairing code, not
   separate architectures.
2. The client asks for a target and the hub suggests a transport: the relay for
   a remote harness or a client already on the relay, the Docker network for a
   local container, and loopback for a local host. Relay and Direct are always
   selectable. When the target cannot reach the hub's loopback listener, the
   panel asks for a reachable WebSocket URL, offers the hub's container and LAN
   addresses, and lets Clara Desktop use the selected container's Docker
   gateway. The hub never turns a reachable local path into a relay requirement.
   A loopback direct URL for a remote or container target is allowed with a
   warning; the hub cannot verify a remote route.
3. Adapter pairing uses the same one-time code, fingerprint, expiry, E2EE
   handshake, replay guard, and revocation model as browser pairing. A relay
   code carries a ten-minute enrollment grant; the adapter then receives and
   stores a thirty-day grant that the hub refreshes on each connect.
4. The adapter keeps a stable harness identity. Reinstall, re-pair, and
   connection deletion keep Clara session/project metadata; **Forget** purges
   it explicitly.
5. The hub owns Clara metadata. Adapters return harness-native data and never
   store snooze, archive, view, or project settings.
6. Project lifecycle is capability-gated. The hub sends
   `POST /harness/v1/projects/:projectID/archive`, `.../unarchive`, and
   `DELETE /harness/v1/projects/:projectID` to every linked harness and reports
   each result. An adapter advertises `projects.archive`, `projects.unarchive`,
   and `projects.delete`; one that does not is reported as unsupported while
   Clara still applies its own archive or delete. The OpenCode adapter maps
   those actions to bulk session archive/unarchive/delete; the Claude Code
   adapter reports them as unsupported and leaves its transcripts untouched.
   Clara never creates projects from a harness project list, so a harness cannot
   add or hide a Clara project.
7. A harness version bump changes only that adapter. The hub and web branch on
   capability flags, not harness kind.
8. The OpenCode installer installs the daemon, the OpenCode binding, and the
   shared runner. `--no-runner` and `--no-service` split those pieces. The
   Claude Code installer installs only the adapter and its service; it does not
   install an orchestration binding. The packaged command,
   `clara adapter install opencode` and `clara adapter install claude`, runs the
   same adapter binaries. Pass `--from <package|dist>` to install a checkout
   build instead of a registry release. The hub never executes an install. A
   browser copies the command; Clara Desktop runs it through its loopback
   adapter-host sidecar, which uses the user's SSH agent and Docker socket.
9. The Claude Code adapter speaks to the Agent SDK inside the adapter process.
   The SDK is pinned with the adapter and never imported by the hub, web client,
   or shared packages.
10. The hub embeds no adapter artifacts and runs no install script. It reads
    `<registry>/<kind>/manifest.json`, verifies the manifest, and returns the
    install script URL, its SHA-256, and the one-line command. The script
    downloads the platform archive and verifies it on the target. Adapter setup
    is off by default and is enabled in **Settings → Adapter downloads**; the
    switch only gates manifest reads and code issuance, never local execution.
11. An online adapter advertises `host.metrics` and serves
    `/harness/v1/host`. The sample describes the machine or container running
    the adapter: CPU and memory use cgroup v2 limits when the adapter is in a
    container, and disk covers only the adapter data and config directories.
    The hub asks at most once per panel poll, caches the sample, and treats a
    missing route as unsupported until the adapter reconnects.

## Adapter mapping

| Clara concept        | Claude Code mapping                                                                                    |
| -------------------- | ------------------------------------------------------------------------------------------------------ |
| Project id           | Canonical session directory                                                                            |
| Session id           | Claude session UUID                                                                                    |
| Assistant step       | Claude API message; transcript blocks sharing a message id are one step                                |
| Model                | `{ providerID: <resolved provider>, id: <model> }`                                                     |
| Session list         | Claude transcripts merged with the adapter's sidecar catalog                                           |
| Messages             | Transcript entries grouped by API message id; tool results fold into the requesting tool               |
| Streaming            | Agent SDK stream events translated to one Clara step per API response                                  |
| Approvals            | `canUseTool` → Clara permission cards                                                                  |
| Clarifying questions | `AskUserQuestion` → Clara forms                                                                        |
| Commands             | Claude slash commands, including user, project, and plugin commands; terminal-only commands are hidden |
| Skills               | User, project, and plugin `SKILL.md` files; built-in skills also appear as slash commands              |
| Agents               | Subagent definitions listed read-only; Claude's Task tool invokes them                                 |
| Plugins              | Loaded from Claude Code settings; names appear in `clara-adapter-claude status`                        |
| Usage                | Result cost and model usage, cumulative in the sidecar catalog                                         |
| Files, VCS, git      | Read-only filesystem and git queries inside the adapter                                                |
| Archive/delete       | Unsupported on the harness; Clara applies its own state                                                |

Claude Code streams one assistant message per completed content block, each with
its own wrapper UUID, while every frame for one model response shares the
Anthropic API message id. The adapter uses that API id as the Clara step id for
both live events and transcript history, so a thinking block, text block, and
tool call from the same response stay in one step. A delivered prompt is also
echoed as a user message immediately; it carries the transcript entry UUID, so
the transcript replaces the echo by id instead of duplicating it.

The adapter resolves the provider from Claude Code instead of assuming
Anthropic. A first-party account maps to `anthropic`; Bedrock, Vertex, Foundry,
Anthropic on AWS or Google Cloud, Mantle, and a Claude gateway map to their own
provider ids; an unknown backend is kebab-cased from its `apiProvider` value.
A custom `ANTHROPIC_BASE_URL` maps to `custom-endpoint` unless the installer
sets `--provider-id` and `--provider-name`.

When that endpoint is Ollama, the adapter reads `/api/tags` and lists the models
installed on the server, with their tool, vision, and audio capabilities and
their context length. Claude Code's built-in Claude aliases are omitted in that
case, while custom `modelPicker` labels are kept. Users without Ollama, or with
another Anthropic-compatible proxy, keep the model list Claude Code reports
itself. Discovery is an optional probe: if `/api/tags` does not answer, the
adapter silently falls back.

Claude Code runs one active API backend per process, so the catalog belongs to
that backend. The endpoint comes from `--base-url`, `ANTHROPIC_BASE_URL` in the
adapter environment, or the `env` block of the Claude Code user settings.

## Pi

The Pi adapter runs the `pi` binary the user already installed and speaks Pi's
RPC mode (`pi --mode rpc`) over stdin/stdout. It does not embed the Pi SDK, so
Clara follows the user's Pi version, authentication, `models.json`, extensions,
skills, prompt templates, packages, MCP servers, and project trust decisions.

```bash
clara-adapter-pi install --pair <code> [--pi-path <path>]
```

The installer writes the adapter config, enrolls the adapter, and installs a
user service. `--no-service` runs it in the foreground instead. Pi is discovered
from `--pi-path`, `PI_BIN`, `PATH`, `~/.pi/agent/bin`, then `~/.local/bin`.

Sessions are the same JSONL files Pi itself uses under
`~/.pi/agent/sessions/--<cwd>--/` (or a configured `sessionDir`). The adapter
lists and reads them directly, and a session created in Clara is a normal Pi
session that appears in `pi --resume`. Titles use Pi's `session_info` name.
Clara's archive, snooze, and view state stay in the hub. The adapter keeps one
idle-evicted `pi` process per active session and restarts it before the next
prompt if the file changed underneath it, so continuing a session the user
touched in the Pi TUI follows the newer leaf instead of silently branching.
Pi has no session lock: if both the TUI and Clara write during the same run,
Pi keeps both branches and the transcript follows the last appended one.

Prompt templates and extension commands come from `get_commands`; skills come
from the same command list and are read from their `SKILL.md`. Models and
providers come from `get_available_models`, so the composer shows the user's own
configured catalog. Pi has a single built-in agent, no session move (a session
is bound to its working directory), and no tool-approval system of its own.
Extension dialogs are mapped to Clara: `ctx.ui.confirm` becomes a permission
card, and `select`, `input`, and `editor` become forms. Extensions that do not
ask for confirmation run without one, exactly as in the Pi TUI.

| Clara concept   | Pi mapping                                                                    |
| --------------- | ----------------------------------------------------------------------------- |
| Project id      | Canonical working directory from the session header                           |
| Session id      | Pi session id; the file path is the same JSONL file Pi uses                   |
| Assistant step  | One Pi assistant message; the id is derived from its timestamp                |
| Model           | Pi `provider` and model id, optionally with a thinking-level variant          |
| Session list    | Stat-indexed scan of the Pi session store                                     |
| Messages        | Active branch entries; tool results fold into the requesting tool             |
| Streaming       | RPC session events translated to Clara step, text, reasoning, and tool events |
| Approvals       | Extension `confirm` dialog → Clara permission card                            |
| Questions       | Extension `select`, `input`, and `editor` dialogs → Clara forms               |
| Usage           | Pi message usage and `usage` entries, summed across the session               |
| Commands/skills | `get_commands`, split by `source`                                             |
| Files, VCS, git | Read-only filesystem and git queries inside the adapter                       |
| Archive/delete  | Unsupported on the harness; Clara applies its own archive state               |

## Edge cases

- **Harness not reachable** — the OpenCode installer prompts for URL and
  credentials, then retests. The Claude Code installer reports a missing binary
  or a machine that is not signed in; pairing can still be saved and the panel
  shows **Auth rejected** until the machine signs in.
- **Pairing code expired or used** — generate a new code in the panel.
- **Wrong code pasted in the browser** — adapter codes are named as such; the
  web tells the user to install them with the adapter command and to use
  **Clients → Pair Client** or `clara pair` for a browser.
- **Wrong harness kind** — the adapter rejects a code issued for another type.
- **Adapter connected** — it appears under **Harness → Connected adapters**
  with its harness label, kind, short harness id, and credential fingerprint.
  The browser **Clients** view stays device-only and excludes it from its counts.
- **Adapter offline** — the panel shows **Paired · Offline**, keeps the
  connection, and `/v1` returns `harness_offline`; the adapter reconnects with
  backoff when it returns.
- **Claude Code question or approval** — the turn waits while the request is
  pending. Answering in Clara releases the turn; closing the turn denies the
  pending request.
- **Claude Code session created in Clara** — the sidecar catalog keeps it
  visible before its first prompt. The first turn fixes the Claude UUID so a
  reinstall or resume finds the same transcript.
- **Claude Code skills** — Clara reads `SKILL.md` from the user, project, and
  plugin skill directories. Built-in skills also appear as slash commands, so
  both menus expose the same capability.
- **Claude Code subagents** — the agent picker lists them read-only. Claude
  invokes one through its Task tool, so selecting a subagent as the session's
  main-thread agent is not offered.
- **Claude Code terminal commands** — slash commands that belong to the local
  terminal are hidden from Clara's command menu, matching the Agent SDK's
  remote-surface guidance.
- **Claude Code session moved** — the adapter records the new directory and
  resumes from Claude's cross-project lookup. Clara keeps its project link.
- **Pi project trust** — the adapter inherits Pi's saved decisions. Print, JSON,
  and RPC modes cannot prompt, so an untrusted project loads only global
  resources; the same `trust.json` and `defaultProjectTrust` rules apply as in
  the Pi TUI. `--project-trust always|never` passes Pi's `--approve` or
  `--no-approve` for every session.
- **Pi extension confirmation** — the turn waits while the confirmation is
  pending. Answering releases it; rejecting returns an explicit no. A Pi
  extension that owns its own policy can still act without asking.
- **Pi session used in both places** — Pi has no session lock. Clara detects an
  idle file change and reloads before the next prompt. Concurrent writes during
  one run create two valid Pi branches; Clara shows the active (last) one.
- **Harness access off** — adapters keep their credentials but the panel shows
  **Off** and the hub does not proxy until the legacy harness gate is on again.
- **Adapter reinstalled** — the same identity reconnects the same sessions and
  metadata without duplicating the connection.
- **Relay offline** — the adapter reconnects when the relay or hub returns.
- **Adapter setup off** — the hub cannot read the registry or issue a code until
  the owner turns on **Settings → Adapter downloads**. The switch never enables
  local execution.
- **Registry unreachable** — the panel names the manifest error and does not
  create a code. The manual repository commands still work from a checkout.
- **Adapter behind the registry** — the Adapter setup card shows the connected
  adapter version beside the published one and names the reinstall when they
  differ. The hub never upgrades an adapter by itself.
- **SSH host missing** — an alias that is not in the client machine's
  `~/.ssh/config` is rejected; enter the user, host, and port manually instead.
- **SSH authentication** — Clara Desktop installs use key or agent
  authentication only (`BatchMode=yes`). Unlock the key in the agent/keychain
  first; a passphrase-protected key that is not in the agent fails without
  prompting.
- **Container has no downloader** — the install stops when the selected
  container has neither `curl` nor `wget`; use a different container or run the
  command by hand. The included OpenCode adapter image ships `curl`.
- **Checksum mismatch** — the client verifies the install script, and the script
  verifies the adapter archive. Either mismatch fails without executing the
  downloaded file.
- **OpenCode needs a password over SSH** — the one-click install cannot prompt
  for credentials. Set `OPENCODE_PASSWORD` in the target environment or run the
  manual installer interactively. The hub never stores the harness password.
- **Unsupported target** — the script lists the platforms it can install and
  exits; use a supported OS/architecture or run the release archive manually.
- **Container recreated** — an install into an ephemeral container does not
  survive recreation. Use a mounted config/data path or the adapter container.
- **Host-process hub, local container** — choose **Local → Docker container**
  and set **Network → Local transport → Listen on** to **This machine and
  local Docker containers**. The hub binds its Docker bridge next to loopback
  and the panel uses that URL. Clara Desktop also reads the selected container's
  gateway. Without a container-reachable address, the panel asks for one instead
  of requiring the relay.
- **Remote machine on the LAN** — set **Listen on** to **All interfaces** (or a
  custom LAN address), then use the hub's LAN URL for a direct pairing. Open the
  local WebSocket port in the host firewall; Docker bridge addresses are not
  reachable from another machine.
- **Docker Desktop** — Docker Desktop keeps its bridge inside a VM. Use
  `host.docker.internal` with **All interfaces**, or use the relay.
- **Remote Docker** — copy the install command and run it inside the container,
  for example
  `ssh user@docker-host "docker exec -i <container> sh -lc '<command>'"`.
  The adapter inside the container must still reach the hub URL: a LAN address
  when the hub is exposed on the LAN, or the relay. One-click remote Docker
  installs are not part of this build.
- **Direct loopback URL for a remote target** — the panel warns but does not
  block. It only works through an SSH or other tunnel that forwards the hub
  port.
- **Direct `wss://` address** — unsupported. A direct hub listener is plain
  `ws://`; use the relay for a public TLS endpoint.

## Out of scope

- Running the adapter inside the hub process.
- An inbound adapter HTTP port.
- A direct public `wss://` hub endpoint. Cloud and other NAT'd installs use the
  relay.
- One-click adapter installs into a remote Docker host; copy or SSH the command
  instead.
- A hub-wide default or active harness. Every paired adapter serves the
  workspaces and sessions that belong to it.
- A Claude Code orchestration binding or shared runner integration.
- A shipped Claude Code container image.
- A Pi orchestration binding or shared runner integration.
- A shipped Pi container image.
- Attaching to an already-running Pi TUI process. Pi exposes no attach API; the
  adapter shares the session store and configuration instead.

## Known gaps

- The Claude Code adapter does not expose Claude's subagent sessions as separate
  Clara sessions; subagent transcript entries are skipped. Subagent definitions
  are listed read-only and cannot be selected as a session's main-thread agent.
- Per-step Claude cost is not available. The turn result carries the turn cost
  and session totals; intermediate steps show zero cost.
- One Claude Code process uses one API backend. The adapter reports all models
  that backend advertises; it cannot merge catalogs from several providers in
  one session.
- Claude Code's `AskUserQuestion` supports at most four questions with four
  options each, matching Clara form limits.
- Pi has no session lock. Two writers on one session can create branches; Clara
  follows the branch whose entry was appended last.
- Pi exposes no session move. Clara hides move for Pi sessions; fork into the
  target directory instead.
- Pi has one built-in agent, so the agent picker is empty and `sessions.agent`
  is advertised as unsupported.
- A Pi extension confirmation maps to a Clara permission card, but "Always"
  behaves as "Once" because the extension owns the policy and Pi has no
  persistent approval store.
- Per-step Pi cost is the assistant message's reported usage cost; session cost
  sums every persisted usage entry, including compaction.
- Pending pairing codes are shown only in the panel session that created them.
- A relay adapter grant lasts thirty days and is refreshed on each connect. An
  adapter offline longer than that must pair again.
- Host resource samples cover the adapter machine or container. cgroup v1 hosts
  and non-Linux machines report host-wide CPU and memory, and the sample lists
  the adapter data and config volumes, not workspace volumes.

## Technical appendix

<details>
<summary>Protocol, data, and commands</summary>

- Protocol: `/harness/v1` over the adapter's E2EE WebSocket session.
  `/harness/v1/health` returns the adapter's live harness probe;
  `/harness/v1/info` keeps the adapter and harness metadata;
  `/harness/v1/host` returns the adapter machine's CPU, memory, and disk sample.
- Frames: `adapter.request`, `adapter.abort`, `adapter.response`,
  `adapter.chunk`, `adapter.end`, `adapter.error`, `adapter.enroll`,
  `adapter.enrolled`.
- Included adapters: `apps/adapters/opencode`, `apps/adapters/claude`, and
  `apps/adapters/pi`. The OpenCode policy plugin and agent live in
  `apps/adapters/opencode/plugin/`. The Claude adapter keeps all Agent SDK usage
  inside `apps/adapters/claude`. The Pi adapter keeps RPC framing and session
  parsing inside `apps/adapters/pi` and never imports the Pi SDK.
- Harness SDKs: `@opencode/client@2.1.1` for OpenCode, and
  `@anthropic-ai/claude-agent-sdk@0.3.325` for Claude Code. The Claude SDK
  bundles Claude Code 2.1.325. Pi is driven as an external binary over
  `pi --mode rpc`.
- Protocol package: `packages/contracts/harness-protocol`.
- Adapter runtime: `packages/adapters/runtime`; orchestration binding core:
  `packages/adapters/binding`.
- Adapter data: `<config>/clara/adapters/<kind>/config.json` and
  `<data>/clara/adapters/<kind>/{identity.json,adapter.log,adapter.pid,state.json}`.
  Claude also keeps `catalog.json` for created sessions, titles, and usage. Pi
  keeps `prompt-ids.json` to reuse Clara inbox ids in session history.
- Values of `<kind>`: `opencode`, `claude`, and `pi`.
- Tables: `harness_identities`, `harness_connections`, `adapter_credentials`,
  `harness_pairings`, `clara_projects`, `harness_project_links`,
  `clara_sessions`.
- Commands: `clara-adapter-opencode install --pair <code>`,
  `clara-adapter-claude install --pair <code>`,
  `clara-adapter-pi install --pair <code>`,
  `clara adapter install <kind> [--pair <code>] [--from <path>] [--reuse-pairing]`,
  `clara adapter list [--json]`,
  `clara adapter status|start|stop|logs <kind>`,
  `clara adapter verify <kind> [--directory <path>] [--write] [--json]`,
  `clara adapter upgrade [kind]`,
  `clara adapter remove <kind> [--purge]`,
  `clara-adapter-<kind> verify [--directory <path>] [--write] [--json]`,
  `clara-adapter-claude uninstall [--purge]`,
  `clara-adapter-pi uninstall [--purge]`.
  `install --reuse-pairing` reruns discovery, the config write, the binding,
  the service, and the runner from the saved config; `upgrade` calls it with the
  saved install flags and does not enroll a new adapter.
- Registry: `<registry>/<kind>/manifest.json` and
  `<registry>/<kind>/v<version>-install.sh`; the default registry is
  `https://clara.kalenmichael.com/adapters`. The `adapter-releases` workflow
  builds every OS on its own runner, uploads kind-prefixed archives to the
  `adapters-v<version>` GitHub release, and exports the manifest and install
  script as the `adapter-registry` workflow artifact. `pnpm adapters:build`
  locally builds only the host target (or explicit `--targets`) under
  `dist/adapters`; the maintainer deploys the web registry from the artifact.
  `pnpm adapters:build --from-release <tag|latest> --repo <owner/repo>
[--api-url URL]` regenerates the same files from archives already attached to a
  release, reading asset names, sizes, and SHA-256 digests from the GitHub API
  without downloading them. `pnpm deploy:web:registry` pins the newest
  `adapters-v*` release, regenerates the registry, verifies each manifest and
  artifact digest against that release, and then deploys the web app;
  `pnpm adapters:check` runs the same verification without deploying.
  `pnpm deploy:web` runs the same check before `wrangler` (against
  `CLARA_ADAPTER_RELEASE_TAG` when set), so it refuses a registry that is
  missing a harness or target, that points at a local archive URL, or that does
  not match the release. A local build writes relative artifact URLs, so
  `pnpm adapters:serve` (or `adapters:build --serve`) exposes
  `dist/adapters` on loopback and `CLARA_ADAPTER_REGISTRY_URL` points the
  packaged command or hub at it. A served or mirrored build instead writes
  `/kind/file` URLs; a release keeps the flat GitHub asset URL.
  `--from <package|dist>` stages the checkout's `dist/index.js` under the
  adapter data directory and runs it with Node, without Bun or a registry.
- Panel routes: `GET /panel/api/v1/install`, `POST /panel/api/v1/install`, and
  `POST /panel/api/v1/install/settings`. The desktop adapter host exposes
  `/targets`, `/install`, `/install/:id`, and `DELETE /install/:id` on its own
  loopback token.
- Docker: `infra/docker/adapter-opencode.compose.yml`; no published ports.
  No Claude Code or Pi image ships with Clara. Install the adapter in the
  container that runs the harness and mount its config directory and workspace.

</details>
