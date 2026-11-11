---
title: Getting started
description: Open Clara, pair a device, and start your first session.
sidebar_position: 1
---

# Getting started

Clara opens one OpenCode server from a browser or an installed app. Someone who
runs Clara — the **hub** — gives you a URL and a pairing code. You do not need an
OpenCode account or the OpenCode password.

## What you need

- The Clara URL from the person hosting it, for example
  `https://clara.example.com` or `http://127.0.0.1:8080`.
- A current browser: Chrome, Edge, Firefox, or Safari.
- A pairing code or pairing link. Codes expire after 10 minutes.
- Camera access only if you want to scan the QR code. Pasting the code works
  too.

:::note
If you are hosting Clara yourself, start with
[Self-hosting](self-hosting/index.md) instead.
:::

## Pair this device

1. Open the Clara URL. The first screen offers **Scan QR code** and a paste
   field.
2. Ask the host to run the pairing command. They will give you a QR code, a
   link, or a `clara1_…` code.
3. Scan the QR code, open the link, or paste the code.
4. Clara checks the code, enrolls this browser, and stores a device key in the
   browser. The key never leaves the device.
5. Clara opens your last project, or the first project the server returns.

The full flow, including local and relay pairings, is in
[Connect a device](connect.md).

## Start a session

1. Pick a project in the sidebar. Clara remembers the last one.
2. Choose **New session** and type a prompt.
3. Press Enter to send. The reply streams into the thread.
4. When the agent stops, use **Reply** to continue or **Done** to archive the
   session.

A session is called a **Brief** by default. You can rename the noun in
**Settings → Preferences**.

## Install it like an app

Clara is a PWA. On iPhone or iPad, open the page in Safari and choose **Add to
Home Screen**. On a desktop browser, use the install control in the address bar
or the browser menu.

The installed app opens without browser chrome. Updates arrive through an
in-app banner; you choose **Update** or **Later**.

## Next steps

- [Understand the screen](concepts.md) — projects, sessions, and the mailbox.
- [Connect a device](connect.md) — pairing, relay, and device management.
- [Chat and approvals](chat.md) — steer a run and answer permission prompts.
- [Troubleshooting](troubleshooting.md) — if a code or connection fails.
