# Harness adapters

## Summary

Clara reaches a harness through a small adapter daemon. The adapter connects out
to the hub over the same local or relay WebSocket and E2EE session as a browser
client, then speaks the Clara Harness Protocol. The hub is harness-neutral: it
routes typed `/v1` calls to whichever adapter is active and branches on
capability flags, not harness kind. This repository includes the OpenCode and
Claude Code adapters. Additional adapters can use the same pairing, transport,
and capability model.

| Included adapter          | Harness             | Install                                        |
| ------------------------- | ------------------- | ---------------------------------------------- |
| `@clara/adapter-opencode` | OpenCode 2.1.x      | `clara-adapter-opencode install --pair <code>` |
| `@clara/adapter-claude`   | Claude Code 2.1.325 | `clara-adapter-claude install --pair <code>`   |

The adapter, not the hub, discovers and authenticates the harness. The hub never
contacts the harness directly.

## User flow

1. Open the hub panel → **Harness** → **Add harness** → choose OpenCode or
   Claude Code and the adapter location: **Docker network** (default), **This
   machine**, or **Cloudflare relay** → **Add harness**.
2. Copy the pairing code or the matching command. Adapter codes start with
   `clara-harness1_` and only install an adapter; a browser pairs with a
   `clara1_` code from **Clients → Pair Client** or `pnpm clara pair`.
3. On the harness machine, run the adapter installer. For OpenCode that is
   `pnpm clara adapter install --opencode --pair <code>`; for Claude Code it is
   `pnpm clara adapter install --claude --pair <code>`.
4. The OpenCode installer discovers OpenCode from flags, environment, or
   `~/.local/state/opencode/service.json`. The Claude Code installer uses the
   machine's existing Claude Code login and accepts `--claude-path`, `--model`,
   and `--permission-mode`. It never stores an API key.
5. The adapter enrolls and stores its credential. The installer then starts a
   user service, or a background adapter process when systemd/launchd is not
   available. The panel shows **Paired · Offline** under **Paired harnesses**
   until the adapter connects; it then shows **Online** and adds a live row under
   **Connected adapters**. The first adapter is **Active**; turning the Harness
   switch off shows **Off** while the adapter credential is kept.
6. Open the web client. Sessions arrive through the adapter; Clara projects are
   created in the web client and their workspaces link directories on the
   adapter. The hub never contacts the harness.

## Core business rules

1. The adapter connects out; the hub does not connect to an adapter port.
   Local, Docker, and relay are transport choices in the pairing code, not
   separate architectures.
2. The panel chooses the pairing transport: Docker network for an adapter
   container, loopback for an adapter on the hub host, or the relay for a
   remote adapter. The default is Docker.
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
   install an orchestration binding. Inside the repository,
   `pnpm clara adapter install --opencode` and `--claude` dispatch to the same
   adapter binaries.
9. The Claude Code adapter speaks to the Agent SDK inside the adapter process.
   The SDK is pinned with the adapter and never imported by the hub, web client,
   or shared packages.

## Adapter mapping

| Clara concept        | Claude Code mapping                                                                      |
| -------------------- | ---------------------------------------------------------------------------------------- |
| Project id           | Canonical session directory                                                              |
| Session id           | Claude session UUID                                                                      |
| Assistant step       | Claude API message; transcript blocks sharing a message id are one step                  |
| Model                | `{ providerID: <resolved provider>, id: <model> }`                                       |
| Session list         | Claude transcripts merged with the adapter's sidecar catalog                             |
| Messages             | Transcript entries grouped by API message id; tool results fold into the requesting tool |
| Streaming            | Agent SDK stream events translated to one Clara step per API response                    |
| Approvals            | `canUseTool` → Clara permission cards                                                    |
| Clarifying questions | `AskUserQuestion` → Clara forms                                                          |
| Usage                | Result cost and model usage, cumulative in the sidecar catalog                           |
| Files, VCS, git      | Read-only filesystem and git queries inside the adapter                                  |
| Archive/delete       | Unsupported on the harness; Clara applies its own state                                  |

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

## Edge cases

- **Harness not reachable** — the OpenCode installer prompts for URL and
  credentials, then retests. The Claude Code installer reports a missing binary
  or a machine that is not signed in; pairing can still be saved and the panel
  shows **Auth rejected** until the machine signs in.
- **Pairing code expired or used** — generate a new code in the panel.
- **Wrong code pasted in the browser** — adapter codes are named as such; the
  web tells the user to install them with the adapter command and to use
  **Clients → Pair Client** or `pnpm clara pair` for a browser.
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
- **Claude Code session moved** — the adapter records the new directory and
  resumes from Claude's cross-project lookup. Clara keeps its project link.
- **Harness access off** — adapters keep their credentials but the panel shows
  **Off** and the hub does not proxy until the legacy harness gate is on again.
- **Adapter reinstalled** — the same identity reconnects the same sessions and
  metadata without duplicating the connection.
- **Relay offline** — the adapter reconnects when the relay or hub returns.

## Out of scope

- Running the adapter inside the hub process.
- An inbound adapter HTTP port.
- A per-client active harness; the panel keeps one default backend while every
  paired adapter serves the workspaces that belong to it.
- A Claude Code orchestration binding or shared runner integration.
- A shipped Claude Code container image.

## Known gaps

- The Claude Code adapter does not expose Claude's subagent sessions as separate
  Clara sessions; subagent transcript entries are skipped.
- Per-step Claude cost is not available. The turn result carries the turn cost
  and session totals; intermediate steps show zero cost.
- One Claude Code process uses one API backend. The adapter reports all models
  that backend advertises; it cannot merge catalogs from several providers in
  one session.
- Claude Code's `AskUserQuestion` supports at most four questions with four
  options each, matching Clara form limits.
- Pending pairing codes are shown only in the panel session that created them.
- A relay adapter grant lasts thirty days and is refreshed on each connect. An
  adapter offline longer than that must pair again.

## Technical appendix

<details>
<summary>Protocol, data, and commands</summary>

- Protocol: `/harness/v1` over the adapter's E2EE WebSocket session.
  `/harness/v1/health` returns the adapter's live harness probe;
  `/harness/v1/info` keeps the adapter and harness metadata.
- Frames: `adapter.request`, `adapter.abort`, `adapter.response`,
  `adapter.chunk`, `adapter.end`, `adapter.error`, `adapter.enroll`,
  `adapter.enrolled`.
- Included adapters: `apps/adapters/opencode` and `apps/adapters/claude`.
  The OpenCode policy plugin and agent live in `apps/adapters/opencode/plugin/`.
  The Claude adapter keeps all Agent SDK usage inside
  `apps/adapters/claude`.
- Harness SDKs: `@opencode/client@2.1.1` for OpenCode, and
  `@anthropic-ai/claude-agent-sdk@0.3.325` for Claude Code. The Claude SDK
  bundles Claude Code 2.1.325.
- Protocol package: `packages/contracts/harness-protocol`.
- Adapter runtime: `packages/adapters/runtime`; orchestration binding core:
  `packages/adapters/binding`.
- Adapter data: `<config>/clara/adapters/<kind>/config.json` and
  `<data>/clara/adapters/<kind>/{identity.json,adapter.log,adapter.pid,state.json}`.
  Claude also keeps `catalog.json` for created sessions, titles, and usage.
- Values of `<kind>`: `opencode` and `claude`.
- Tables: `harness_identities`, `harness_connections`, `adapter_credentials`,
  `harness_pairings`, `clara_projects`, `harness_project_links`,
  `clara_sessions`.
- Commands: `clara-adapter-opencode install --pair <code>`,
  `clara-adapter-claude install --pair <code>`,
  `pnpm clara adapter install --claude --pair <code>`,
  `pnpm clara adapter status [--claude]`,
  `clara-adapter-claude uninstall [--purge]`.
- Docker: `infra/docker/adapter-opencode.compose.yml`; no published ports.
  No Claude Code image ships with Clara. Install the adapter in the container
  that runs Claude Code and mount the Claude config directory and workspace.

</details>
