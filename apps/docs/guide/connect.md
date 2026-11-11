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
3. Point the camera at the QR code on the hub host's screen or terminal.
4. Clara recognizes the code and connects as soon as it is readable.

Camera frames are decoded on the device. They are not uploaded to the hub or the
relay.

## Pair with a code or link

- Paste a `clara1_…` code into the pairing field.
- Open a `#pair=…` link. Clara reads it from the URL fragment, so the fragment
  never reaches the web host or Cloudflare.
- A pairing link opens a connecting screen and finishes on its own.

## Local and relay pairings

A **local** pairing connects directly to the hub on the same machine or trusted
network. It uses a `ws://` address and only works from `localhost`, a local IP, or
an SSH tunnel.

A **relay** pairing goes through Cloudflare. Use it when the browser is on a
phone or another network. A page loaded over HTTPS cannot open a `ws://` socket,
so remote devices need a relay pairing.

If a code does not connect, ask the host whether the hub is running and whether
the code was local or relay. The error on the connect screen names the failing
step.

## Fingerprints

Each device has a fingerprint derived from its key. The host can compare the
fingerprint shown in the hub panel with the one printed by the pairing command.
If they differ, do not trust the pairing; ask for a fresh code.

## Manage this device

- **Settings → Reconnect** proves the transport again without forgetting the
  device. The sidebar health control offers the same action.
- **Settings → Disconnect** removes the device from this browser and returns to
  the connect screen. The device stays listed on the hub until the host revokes
  it.
- A revoked device is rejected on its next handshake or action. Pair again with
  a fresh code if you still need access.

The host can set a display alias for a device in the hub panel. The enrolled
label stays visible underneath.

## What the hub can see

The hub needs the OpenCode password to talk to OpenCode. That password is never
sent to the browser. Prompts, replies, and tool output travel inside the
encrypted WebSocket. The relay sees ciphertext, frame sizes, timing, and room
metadata, not your conversation.

Read [Security and privacy](security.md) for the full picture.

## If pairing fails

- **Invalid or truncated code** — paste the whole `clara1_…` value or scan again.
- **Expired or used code** — ask for a new one.
- **Camera permission denied** — allow camera access for the site, then retry.
  Pasting still works.
- **Relay offline** — the hub is not connected to its room. Ask the host to check
  the relay card in the hub panel.
- **Revoked device** — the host revoked this browser. Pair again.

More cases are in [Troubleshooting](troubleshooting.md).
