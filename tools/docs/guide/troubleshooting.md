---
title: Troubleshooting
description: Fix pairing, connection, update, and notification problems.
sidebar_position: 12
---

# Troubleshooting

Start with the exact message on screen. Clara reports the failing step instead of
a generic error.

## I cannot open Clara

- Confirm the URL with the host. A local URL such as `http://127.0.0.1:8080`
  only works on that machine or through an SSH tunnel.
- A remote page must be served over HTTPS. A plain `http://` page cannot open a
  secure context for the camera or push.
- If the page loads but stays blank, clear cached app data from
  **Settings → Advanced**, or reload once. The host can also check the web
  service status.

## The pairing code fails

| Message                   | Fix                                                                                                                                        |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Adapter pairing code      | Adapter codes (`clara-harness1_…`) install the adapter, not the browser. Use **Clients → Pair Client** or `clara pair` for a browser code. |
| Invalid or truncated code | Paste the whole `clara1_…` value or scan the QR again.                                                                                     |
| Expired code              | Codes last 10 minutes. Ask for a fresh one.                                                                                                |
| Code already used         | Each code enrolls one device. Ask for a new code.                                                                                          |
| Fingerprint mismatch      | Do not trust the pairing. Ask the host for a fresh code and compare again.                                                                 |
| Device revoked            | The host revoked this browser. Pair again if access is still needed.                                                                       |

## The camera will not scan

- Allow camera access for the Clara site in the browser settings. On iPhone,
  use **Settings → Safari → Camera**; home-screen apps share Safari's permission.
- The camera only opens on HTTPS or `localhost`.
- If the preview stays black after resuming the app, close and reopen the
  scanner.
- If the camera is busy or missing, paste the code instead.

## Clara connects but shows no projects

Clara can reach the hub while the harness is unavailable. A banner names the
problem and offers **Retry**.

- No harness is answering. Ask the host to open the hub panel and check that at
  least one adapter says **Online** under **Connected adapters**. A project that
  uses a workspace on an offline harness keeps working on the other harnesses.
- If it says **Paired · Offline**, start the adapter service on the harness
  machine.
- If the hub returns `harness_unconfigured`, no adapter is paired.
- If the page says **Off**, harness access is disabled in the hub's settings.
- A containerized adapter connects to the hub on the `clara` network, not to
  `127.0.0.1`.

## One project spans several harnesses

A project can hold a workspace on more than one harness, of any kind, on any
machine. When one of them is offline:

- Session lists keep the rows from the harnesses that answered. The project page
  shows which workspace is offline.
- Counts on project cards and the project page stay visible but are marked
  partial and name the missing harness. **Counts unavailable** means no linked
  harness answered.
- **New session** shows the offline workspace as disabled. Start in another
  workspace, or reconnect that harness and try again.
- If the same path exists on two machines, Clara refuses to guess and reports
  that the path matches more than one harness. Make the intended harness the
  active one, or give the workspaces distinct labels.

## The relay is offline

The browser can reach Cloudflare but not the hub. Ask the host to check the relay
card in the hub panel and confirm that the hub service is running and connected
to its room. A hub restart closes clients temporarily; Clara reconnects on its
own.

## The connection drops repeatedly

- Check the hub and relay status on the host.
- A revoked device disconnects and needs a new pairing.
- A hub restart sends clients through a reconnect with the stored device key.
- If only one network fails, try the other transport: local on the same machine,
  relay from a remote device.

## The relay keeps saying another hub connected

The Relay card reports **Another hub connected to this room** when a second hub
process uses the same hub token and room. The hub that was replaced waits at
least 30 seconds before it reconnects, so the two do not evict each other in a
tight loop, but remote clients still drop until you fix it.

1. Find and stop the second hub. Check other machines, old containers, and a
   copy started with a different config directory.
2. Rotate the Worker secret with `wrangler secret put CLARA_AGENT_TOKEN`, then
   save the same value in **Connections → Relay**, or deploy the relay again
   from the panel.
3. Watch the Relay card until it stays online and the warning stops.
4. If the Cloudflare API token may have leaked, rotate it in Cloudflare and
   update the token saved in the panel.

Rotating the hub token does not require devices to pair again. Pair again only
when the relay URL or the room changes.

## An update will not install

The update banner offers **Update** and **Later**. If the app seems stuck:

If Clara is not paired yet, use the reload control at the bottom of the pairing
screen. It sits beside the app version and protocol version, and on the web it
resets the cached app before reloading.

1. Close every Clara window. The next launch installs a deferred update.
2. Open **Settings → Advanced → Update and reload**.
3. If the app is wedged, use **Clear cached app data**. Pairing, settings, and
   drafts are preserved.

A client stuck on an old worker may need up to four hours for the worker script
to expire before it can recover remotely.

If Update leaves the banner up, the new worker has not taken over yet. Try
again, or close every Clara window so it can activate on the next launch. Clara
only offers an update once per deploy, so a second banner for the same deploy is
not expected; a rebuild of the same commit installs on the next launch instead
of prompting.

## Push notifications do not arrive

- Check the browser permission for Clara.
- On iPhone and iPad, add Clara to the Home Screen and open it from that icon
  before enabling push.
- Use **Send test** in **Settings → Notifications**.
- A visible desktop Clara window can hold mobile pushes for five minutes by
  default. Hide or close it, or change **Hold phone alerts**.
- If the subscription was dropped, clear cached app data and subscribe again.

## The hub reports a push storage error

The Push card in the hub panel can show **Subscription storage: Unavailable**.
The VAPID key is separate, so it can still read **Configured**; only saving new
subscriptions is blocked.

- Make sure the account that runs the hub service can read the subscriptions
  file in the hub's config directory. A container or login service that runs as
  a different user sees a different permission set than your terminal.
- After fixing the file's permissions, choose **Retry storage** in the panel.
  If the hub started before the file was readable, restart the hub service.
- If the file is corrupt or cannot be repaired, choose **Reset subscriptions**.
  This deletes every stored push subscription, so each device must enable
  notifications again.

## Desktop notifications work but sounds do not

Inbox sounds and UI sounds are separate. Check the Inbox sounds switch, the
per-state mutes, the volume, and the UI sounds switch. With Simplify settings on,
the single Inbox switch controls all four states.

## A local browser rejects the WebSocket

Browsers share cookies across every port on the same host. A large local cookie
jar can exceed the proxy's header buffer. Open `http://localhost:8080` instead of
`127.0.0.1`; it uses a separate cookie jar.

## Sessions disappear or look stale

The sidebar keeps the last list visible when a background refresh fails and shows
a compact notice. Use the refresh action, or reconnect from Settings. The session
list is scoped to the selected project, which can draw sessions from several
harnesses; a failed lookup for one harness does not empty the list.

## Orchestration is not available

Orchestration is optional. If the service is stopped, orchestration runs and
worker sessions are unavailable. The host can start it from the hub panel or
with `clara start engine`. See
[Orchestration](self-hosting/orchestration.md).

## A Docker container keeps restarting

`clara start` checks the Docker environment before it launches a container
and prints the recent log lines when a service does not become healthy. If a
container still keeps restarting:

- Read the printed log tail, or run `clara logs hub`, `clara logs web`,
  or `clara logs engine`.
- A `CLARA_RELAY_URL` without `CLARA_AGENT_TOKEN` stops the hub at startup only
  when the panel has not saved the token. `clara start` warns about the gap
  before launching the container.
- `CLARA_SERVER_CONFIG_DIR`, `CLARA_SERVER_DATA_DIR`, and
  `CLARA_ORCHESTRATOR_DATA_DIR` must be absolute host paths when set.
- Stopping the stack does not need any of those values exported in your shell.

## The hub container stops with EACCES

`[clara] fatal: EACCES: permission denied, mkdir '/data/runtime.json.lock'` means
the config or data directory is not writable by the container user, which is
UID/GID 1000. A volume created by an older image, or a bind-mounted host
directory, can have a different owner. Stop the stack and fix ownership once;
the data is kept:

```bash
clara stop
docker run --rm \
  -v clara-server-config:/config \
  -v clara-server-data:/data \
  node:22-bookworm-slim \
  chown -R 1000:1000 /config /data
```

For bind mounts, change the owner of the host directories instead.

## Still stuck

Ask the host for the hub panel status and the service logs. The panel shows
harness, local transport, relay, push, and orchestration health without exposing
secrets.
