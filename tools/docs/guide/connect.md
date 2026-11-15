---
title: Connect a device
description: Pair a browser or installed app, use a relay, and manage devices.
sidebar_position: 3
---

# Connect a device

Pairing gives one browser or installed app its own key. There is no shared
password and no shared browser key. A code works once and expires after 10
minutes.

## Pair with a QR code

1. Open Clara on the device you want to use.
2. Choose **Scan QR code**. The first time, the browser asks for camera access.
3. Point the camera at the QR code on the hub host's screen or terminal. A relay
   QR holds more data than a local one, so let it fill the middle of the frame.
4. Clara recognizes the code and connects as soon as it is readable.

Camera frames are decoded on the device. They are not uploaded to the hub or the
relay. If the terminal cannot fit the QR, it prints a note and the link and code
instead; open the link or paste the code on the device.

## Pair with a code or link

- Paste a `clara1_…` code into the pairing field.
- Open a `#pair=…` link. Clara reads it from the URL fragment, so the fragment
  never reaches the web host or Cloudflare.
- A pairing link opens a connecting screen and finishes on its own.

## Pair from the hub panel

On the machine that runs the hub, open **Clients** and choose **Pair Client**.
Pick **Relay** or **Local**, then choose **Create pairing link**. The dialog shows
a QR code, an **Open Link** action, the expiry, and **Copy code** and **Copy
link** buttons. It reports **Waiting to connect** until the device enrolls, then
**Connected**. Closing before enrollment cancels the unused code; closing after
it leaves the new device in place. The guided-setup Client step shows the same
pairing controls inline.

## Open the hub panel from Clara

Paired devices can open the same hub panel inside Clara Desktop. Choose **Hub**
in the app and sign in with the hub owner's username and password. Pairing a
device does not grant panel access by itself, and the panel password is never
sent through the relay in readable form.

The app reaches the panel through its encrypted hub connection, so a remote hub
works without opening a port or visiting its loopback address. Controls that
would cut that connection are disabled there; use the hub host's own panel for
those and for first-run owner setup. See [Desktop app](desktop.md).

## Local and relay pairings

A **local** pairing connects directly to the hub on the same machine or trusted
network. It uses a `ws://` address and only works from `localhost`, a local IP, or
an SSH tunnel.

A **relay** pairing goes through Cloudflare. Use it when the browser is on a
phone or another network. A page loaded over HTTPS cannot open a `ws://` socket,
so remote devices need a relay pairing. When a relay is configured, the host can
choose **Relay** or **Local** in the Pair Client dialog, or run
`clara pair --no-relay`, to force a local code.

If a code does not connect, ask the host whether the hub is running and whether
the code was local or relay. The error on the connect screen names the failing
step.

## Fingerprints

Each device has a fingerprint derived from its key. The host can compare the
fingerprint shown in the hub panel's paired-devices list with the one shown in the
browser, or printed by the pairing command. If they differ, do not trust the
pairing; ask for a fresh code.

## Manage this device

- **Settings → Reconnect** proves the transport again without forgetting the
  device. The health control at the left of the bottom status bar offers the same
  action.
- **Settings → Disconnect** removes the device from this browser and returns to
  the connect screen. The device stays listed on the hub until the host revokes
  it.
- A revoked device is rejected on its next handshake or action. Pair again with
  a fresh code if you still need access.

The host can set a display alias for a device in the hub panel. The enrolled
label stays visible underneath.

## What the hub can see

The adapter holds the harness password and talks to the harness. That password is
never sent to the browser. Prompts, replies, and tool output travel inside the
encrypted WebSocket; the hub routes them and can read them in transit. The relay
sees ciphertext, frame sizes, timing, and room metadata, not your conversation.

Read [Security and privacy](security.md) for the full picture.

## If pairing fails

- **Invalid or truncated code** — paste the whole `clara1_…` value or scan again.
- **Expired or used code** — ask for a new one.
- **Camera permission denied** — allow camera access for the site, then retry.
  Pasting still works.
- **Relay offline** — the hub is not connected to its room. Ask the host to check
  the relay card in the hub panel.
- **Revoked device** — the host revoked this browser. Pair again.
- **Stale app** — the bottom of the pairing screen shows the surface label and
  app version plus the protocol version next to a reload control. On the web it
  resets the installed app's cached files before reloading; on desktop it reloads
  the app. Pairing is not affected.

More cases are in [Troubleshooting](troubleshooting.md).
