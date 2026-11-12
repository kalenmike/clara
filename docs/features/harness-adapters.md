# Harness adapters

## Summary

Clara reaches a harness through a small adapter daemon. The adapter connects out
to the hub over the same local or relay WebSocket and E2EE session as a browser
client, then speaks the Clara Harness Protocol. OpenCode is the first adapter:
installing it installs both the hub-facing daemon and the orchestration binding.

## User flow

1. Open the hub panel → **Harness adapters** → choose **OpenCode** and the
   adapter location: **Docker network** (default), **This machine**, or
   **Cloudflare relay** → **Add harness**.
2. Copy the pairing code or the matching command. Panel codes start with
   `clara-harness1_` and only install an adapter; the browser still pairs with
   a `clara1_` code from `pnpm clara pair`.
3. On the machine that runs OpenCode, run
   `pnpm clara adapter install --opencode --pair <code>`.
4. The installer discovers OpenCode from flags, environment, or
   `~/.local/state/opencode/service.json`. If it cannot reach OpenCode, it
   prompts for the URL, username, and password.
5. The adapter enrolls and stores its credential. The installer then starts a
   user service, or a background adapter process when systemd/launchd is not
   available. The panel shows **Paired · Offline** until the adapter connects,
   then **Online**. The first adapter is **Active**; turning the Harness switch
   off shows **Off** while the adapter credential is kept.
6. Open the web client. Sessions and projects arrive through the adapter; the
   hub never contacts OpenCode.

## Core business rules

1. The adapter connects out; the hub does not connect to an adapter port.
   Local and relay are transport choices in the pairing code, not separate
   architectures.
2. The panel chooses the pairing transport: Docker network for an adapter
   container, loopback for an adapter on the hub host, or the relay for a
   remote adapter. The default is Docker.
3. Adapter pairing uses the same one-time code, fingerprint, expiry, E2EE
   handshake, replay guard, and revocation model as browser pairing.
4. The adapter keeps a stable harness identity. Reinstall, re-pair, and
   connection deletion keep Clara session/project metadata; **Forget** purges
   it explicitly.
5. The hub owns Clara metadata. Adapters return harness-native data and never
   store snooze, archive, view, or project settings.
6. A harness version bump changes only that adapter. The hub and web branch on
   capability flags, not harness kind.
7. `adapter install --opencode` installs the daemon and the orchestration
   binding by default; `--no-daemon` and `--no-orchestration` split them.

## Edge cases

- **OpenCode not reachable** — the installer prompts for URL and credentials,
  then retests.
- **Pairing code expired or used** — generate a new code in the panel.
- **Wrong code pasted in the browser** — panel codes are named as adapter codes;
  the web tells the user to install them with the adapter command and to use
  `pnpm clara pair` for a browser.
- **Wrong harness kind** — the adapter rejects a code issued for another type.
- **Adapter offline** — the panel shows **Paired · Offline**, keeps the
  connection, and `/v1` returns `harness_offline`; the adapter reconnects with
  backoff when it returns. The web stays connected and shows a retryable
  harness banner. A hub restart clears persisted online state, and a socket
  close clears it immediately. The adapter logs `adapter authenticated` only
  after it decrypts a hub frame, so a key mismatch is visible instead of being
  reported as a successful recovery.
- **Adapter link looks online but probes time out** — the hub serializes
  inbound sealed frames per session and clears the live fetch through
  `closeSession` on a protocol failure. The adapter serializes outbound frames,
  sends an application-level heartbeat, and reconnects when the hub closes its
  session. Use `pnpm clara adapter status --json` for the last hub link state
  and the adapter's last OpenCode health check instead of relying on a fresh
  OpenCode probe.
- **Harness switch off** — adapters keep their credentials but the panel shows
  **Off** and the hub does not proxy until the switch is on again.
- **Adapter reinstalled** — the same identity reconnects the same sessions and
  metadata without duplicating the connection.
- **Connection deleted** — identity and metadata stay; re-pairing restores the
  connection; use **Forget** to purge.
- **Two adapters claim one identity** — the latest enrollment wins and the
  panel warns; revoke or forget the stale one.
- **Relay offline** — the adapter reconnects when the relay or hub returns.

## Out of scope

- Running the adapter inside the hub process.
- An inbound adapter HTTP port.
- Multiple active adapters at once.
- A second adapter type in this release.

## Known gaps

- Pending pairing codes are shown only in the panel session that created them;
  the snapshot keeps the pairing list for the paired result.
- The relay client token is shared by browser clients and adapters, as before.
- The hub broadcasts hub frames to every client on a transport. Adapters and
  browsers filter them by session id; routing each frame only to its owning
  connection is still a future improvement.

## Technical appendix

<details>
<summary>Protocol, data, and commands</summary>

- Protocol: `/harness/v1` over the adapter's E2EE WebSocket session.
  `/harness/v1/health` returns a live OpenCode probe; `/harness/v1/info` keeps
  the adapter and harness metadata.
- Frames: `adapter.request`, `adapter.abort`, `adapter.response`,
  `adapter.chunk`, `adapter.end`, `adapter.error`, `adapter.enroll`,
  `adapter.enrolled`.
- Adapter app: `apps/adapter-opencode`. It uses `@opencode/client@2.1.1` for
  all OpenCode HTTP and SSE access; there is no raw OpenCode `/api` proxy.
- Protocol package: `packages/harness-protocol`.
- Adapter data: `identity.json`, `adapter.log`, `adapter.pid`, and
  `state.json`. The last records the live hub link, last frame time, last
  error, and the last OpenCode health check for `pnpm clara adapter status`.
- Tables: `harness_identities`, `harness_connections`, `adapter_credentials`,
  `harness_pairings`, `clara_projects`, `harness_project_links`,
  `clara_sessions`.
- Commands: `pnpm clara adapter install --opencode --pair <code>`,
  `pnpm clara adapter status [--json]`, `pnpm clara adapter uninstall
--opencode [--purge]`.
- Docker: `docker/adapter-opencode.compose.yml`; no published ports.
- Related: [pairing.md](pairing.md), [connection.md](connection.md),
  [panel.md](panel.md), [api.md](../architecture/api.md).

</details>
