# Clara Harness Protocol

The Clara Harness Protocol is version 1 and lives under `/harness/v1` on the
adapter's own end-to-end encrypted WebSocket session. The hub sends typed
requests; the adapter runs them against its harness and streams the response
back. The relay forwards these frames as ciphertext and never parses them.
Pairing, install, and user-visible behavior are in
[harness-adapters.md](../features/harness-adapters.md); the session crypto is in
[E2EE](e2ee.md).

## Transport and handshake

- The adapter opens one outbound WebSocket to the hub's local listener or to the
  relay. Both use the v4 handshake; an adapter differs from a browser only in the
  adapter flag, the adapter id, and the credential that seals the session.
- A relay socket carries the adapter grant in its subprotocols. A local socket
  is bare. The relay verifies the grant before the upgrade, so an expired or
  unknown grant answers `401` and retrying cannot succeed.
- The adapter hello carries `sid`, `nonce`, `role`, `eph`, its adapter id, and an
  adapter flag. The hub answers with a v4 hello whose MAC covers the transcript
  and is keyed by the adapter credential. The adapter verifies the MAC before
  adopting any derived key.
- An enrollment session uses the one-time token as its static key. Its first
  payload is `adapter.enroll`; the hub stores the adapter and answers
  `adapter.enrolled`, then retires the enrollment session.
- After authentication the hub sends a sealed `ready` carrying hub info and a
  refreshed adapter grant. The adapter replies `ready.ack` and persists the
  grant for its next start.
- Heartbeats are `ping`/`pong` every 20 seconds. A session with no hub frame for
  45 seconds is treated as dead. The handshake has a 10-second budget.
- A reconnect backs off from one second to thirty with jitter. The counter resets
  only after an authenticated frame, so a relay that accepts and immediately
  closes cannot cause a one-second flap loop.
- Sealed frames are broadcast to every socket in the room. Each end drops frames
  whose `sid` is not its own before replay checking or decryption.

## Frames

| Frame              | Direction     | Payload                                                                       |
| ------------------ | ------------- | ----------------------------------------------------------------------------- |
| `adapter.request`  | hub → adapter | `id`, `method`, `path`, `search?`, `headers?`, `body?`                        |
| `adapter.abort`    | hub → adapter | `id` of the request whose caller cancelled                                    |
| `adapter.response` | adapter → hub | `id`, `status`, `statusText`, `headers`                                       |
| `adapter.chunk`    | adapter → hub | `id`, base64url body chunk                                                    |
| `adapter.end`      | adapter → hub | `id`; the response body is complete                                           |
| `adapter.error`    | adapter → hub | `id`, `message`, `code` (defaults to `adapter_error`)                         |
| `adapter.enroll`   | adapter → hub | `harnessId`, `kind`, `label`, `credentialId`, `key`, versions, `capabilities` |
| `adapter.enrolled` | hub → adapter | `connectionId`, `harnessId`, `label`, `reconnected`, `relayGrant?`            |

`ping`, `pong`, `ready`, `ready.ack`, and `agent.status` are shared with browser
sessions. One `id` per call; chunks and the terminal frame repeat it. The adapter
aborts its harness request when `adapter.abort` names a live id, and the hub
errors the caller's stream when an adapter disconnects.

## Routes

- `/harness/v1/info` returns `protocol`, `adapter` (`name` and `version`),
  `harness` (`kind` and optional `version`), and `capabilities`. `/health` is the
  live harness probe and `/host` is the adapter machine's CPU, memory, and disk
  sample.
- `/projects` is list and update; `POST /projects/:id/archive`,
  `.../unarchive`, and `DELETE /projects/:id` are capability-gated.
- `/sessions` covers list, create, update, delete, fork, move, view,
  prompt, synthetic, command, interrupt, compact, agent, model, context,
  messages, forms, inbox, and permissions replies.
- Files, VCS, git, and worktrees are read inside the adapter. `/events` is a
  Server-Sent Events stream of Clara events translated from the harness.

## Capability mapping

The hub stores the capabilities an adapter sends at enrollment and reads them
again from `/info`. It branches on flags, never on harness kind:

| Flag                                                              | Gates                                                |
| ----------------------------------------------------------------- | ---------------------------------------------------- |
| `projects.list`, `.update`                                        | Harness project records and workspace linking        |
| `projects.archive`, `.unarchive`                                  | Project archive actions; `unarchive` reads `archive` |
| `projects.delete`                                                 | Project deletion                                     |
| `sessions.*`                                                      | Each session action, including `move` and `agent`    |
| `messages`, `forms`, `inbox`                                      | Message history, forms, and inbox items              |
| `permissions`                                                     | Approval cards and replies                           |
| `catalog.agents\|models\|providers\|commands\|skills\|references` | Composer and picker catalogs                         |
| `files`, `vcs`, `worktrees`, `git`                                | Read-only host queries                               |
| `events`                                                          | The event stream                                     |
| `host.metrics`                                                    | `/host` samples in the panel                         |

A missing flag is reported as `unsupported` for that route, not as a failure;
Clara still applies its own project state. A flag that changes requires the
adapter to reconnect or be upgraded, because the hub caches it per connection.

## Per-adapter differences

| Flag                      | OpenCode | Claude Code | Pi  |
| ------------------------- | -------- | ----------- | --- |
| `projects.archive/delete` | yes      | no          | no  |
| `sessions.move`           | yes      | yes         | no  |
| `sessions.agent`          | yes      | yes         | no  |
| `catalog.agents`          | yes      | yes         | no  |
| `catalog.references`      | yes      | yes         | no  |
| `host.metrics`            | yes      | yes         | yes |

## Sealed-frame limits

- Every frame is JSON: `{ t: "sealed", v: 4, sid, seq, iv, ct }`, sealed with
  AES-256-GCM. AAD binds `sid`, direction, and `seq`; `iv` and `ct` are
  base64url.
- The adapter splits a response body into chunks of at most 64 KiB before
  base64url and JSON overhead, keeping one frame under the relay's 128 KiB
  message cap. The hub reassembles chunks into a single response stream.
- The relay closes a socket with `4009` when one frame exceeds 128 KiB and with
  `4008` when the frame or byte budget refuses it. A persistent loop means a
  response is not being split.
- A strict sequence guard rejects a replayed or out-of-order frame before
  decryption. A frame that fails to open closes the socket as a bad frame.
- An adapter JSON request body is capped at 10 MiB.

## Close codes

| Code   | Source              | Meaning and action                                           |
| ------ | ------------------- | ------------------------------------------------------------ |
| `1000` | either side         | Normal close: shutdown, bad frame, or a hub error code       |
| `1001` | hub                 | Hub restarting; the adapter reconnects with backoff          |
| `1013` | relay               | Relay offline; retry when it returns                         |
| `4002` | relay               | Another socket took over this grant; the replaced one closes |
| `4008` | relay               | Frame or byte budget refused; back off, then pace the sender |
| `4009` | relay               | One sealed frame exceeded 128 KiB; split the response        |
| `401`  | relay (pre-upgrade) | Grant expired or unknown; stop retrying and pair again       |

An error frame from the hub closes the adapter socket with `1000` and the hub's
code in the reason. The adapter keeps the last close for `adapter status`.

## Per-harness mapping

### OpenCode

Project id is the canonical session directory, session id is the OpenCode
session, and an assistant step is one OpenCode assistant message. The model is
`{ providerID, id }`; approvals are OpenCode permission requests and clarifying
questions are form requests. Archive, unarchive, and delete map to bulk session
actions. Catalogs, commands, skills, agents, and references come from OpenCode;
files, VCS, and git queries run inside the adapter.

### Claude Code

| Clara concept        | Claude Code mapping                                                           |
| -------------------- | ----------------------------------------------------------------------------- |
| Project id           | Canonical session directory                                                   |
| Session id           | Claude session UUID                                                           |
| Assistant step       | Claude API message; transcript blocks sharing a message id are one step       |
| Model                | `{ providerID: <resolved provider>, id: <model> }`                            |
| Session list         | Claude transcripts merged with the adapter's sidecar catalog                  |
| Messages             | Transcript entries grouped by API message id; tool results fold in            |
| Streaming            | Agent SDK stream events translated to one Clara step per API response         |
| Approvals            | `canUseTool` → Clara permission cards                                         |
| Clarifying questions | `AskUserQuestion` → Clara forms                                               |
| Commands             | Claude slash commands, including plugin commands; terminal-only ones hide     |
| Skills               | User, project, and plugin `SKILL.md` files; built-ins also appear as commands |
| Agents               | Subagent definitions listed read-only; Claude's Task tool invokes them        |
| Usage                | Turn result cost and model usage, cumulative in the sidecar catalog           |
| Files, VCS, git      | Read-only filesystem and git queries inside the adapter                       |
| Archive/delete       | Unsupported on the harness; Clara applies its own state                       |

Claude streams one assistant message per completed content block, each with its
own wrapper UUID, while frames for one model response share the Anthropic API
message id. The adapter uses that id as the Clara step id, so a thinking block,
text block, and tool call from one response stay together. A delivered prompt is
echoed immediately with the transcript entry UUID, so history replaces the echo
by id.

Providers are resolved from Claude Code: a first-party account maps to
`anthropic`, Bedrock, Vertex, Foundry, Mantle, and a Claude gateway map to their
own ids, and an unknown backend is kebab-cased from `apiProvider`. A custom
`ANTHROPIC_BASE_URL` maps to `custom-endpoint` unless the installer sets
`--provider-id` and `--provider-name`.

When that endpoint is Ollama, the adapter reads `/api/tags` and lists the
installed models with their tool, vision, audio, and context capabilities,
omitting Claude's built-in aliases while keeping custom `modelPicker` labels. If
the probe does not answer, the adapter silently falls back to the list Claude
Code reports. One process uses one API backend, so the catalog belongs to that
backend.

### Pi

| Clara concept   | Pi mapping                                                                    |
| --------------- | ----------------------------------------------------------------------------- |
| Project id      | Canonical working directory from the session header                           |
| Session id      | Pi session id; the file is the JSONL file Pi itself uses                      |
| Assistant step  | One Pi assistant message; the id is derived from its timestamp                |
| Model           | Pi `provider` and model id, optionally with a thinking-level variant          |
| Session list    | Stat-indexed scan of the Pi session store                                     |
| Messages        | Active branch entries; tool results fold into the requesting tool             |
| Streaming       | RPC session events translated to Clara step, text, reasoning, and tool events |
| Approvals       | Extension `confirm` dialog → Clara permission card                            |
| Questions       | Extension `select`, `input`, and `editor` dialogs → Clara forms               |
| Usage           | Pi message usage and `usage` entries, summed across the session               |
| Commands/skills | `get_commands`, split by `source`                                             |
| Archive/delete  | Unsupported on the harness; Clara applies its own archive state               |

Sessions are the JSONL files under `~/.pi/agent/sessions/--<cwd>--/` (or a
configured `sessionDir`); a session created in Clara opens with `pi --resume`.
Titles come from Pi's `session_info` name. The adapter keeps one idle-evicted
`pi` process per active session and restarts it before the next prompt when the
file changed underneath, so work done in the Pi TUI is followed rather than
branched. Models and providers come from `get_available_models`.

## Related

- [Harness adapters](../features/harness-adapters.md)
- [E2EE](e2ee.md)
- [Architecture overview](overview.md)
