---
title: Clara user guide
description: Learn how to use Clara, connect a device, and host the hub service.
sidebar_position: 0
---

# Clara user guide

Clara is a browser and home-screen client for agent harnesses. It lets you open
projects, start and steer sessions, and read what your agents are doing without
sitting at the machine that runs the harness. The hub reaches a harness through
a paired adapter; OpenCode is the adapter included with this release.

This guide has two tracks. Pick the one that matches what you are doing.

## Use Clara

Someone gave you a Clara URL and a pairing code.

- [Getting started](getting-started.md) — pair a device and send your first prompt.
- [Understand the screen](concepts.md) — hubs, projects, sessions, and agents.
- [Connect a device](connect.md) — QR codes, links, relay, and revocation.
- [Projects and sessions](projects-and-sessions.md) — the mailbox and session actions.
- [Chat and approvals](chat.md) — replies, tools, questions, and plan handoff.
- [The reply composer](composer.md) — commands, mentions, attachments, and drafts.
- [Models and usage](models-and-usage.md) — model visibility, tokens, and cost.
- [Settings](settings.md) — appearance, preferences, sync, and recovery.
- [Notifications](notifications.md) — Inbox alerts, sounds, and push.
- [Shortcuts](shortcuts.md) — the leader key and direct keys.
- [Security and privacy](security.md) — what is encrypted and what the hub sees.
- [Desktop app](desktop.md) — build and pair the native window.
- [Troubleshooting](troubleshooting.md) — pairing, connection, and update problems.

## Host Clara

You run a harness and want to reach it from your own devices.

- [Harness adapters](harness-adapters.md) — pair an adapter with the hub.
- [Self-hosting overview](self-hosting/index.md) — requirements and architecture.
- [Docker](self-hosting/docker.md) — the recommended stack.
- [Hub app](hub-app.md) — run the hub and panel from a tray app.
- [Headless server](self-hosting/headless.md) — run the hub without a desktop.
- [Local install](self-hosting/local.md) — Node processes on the host.
- [Configuration](self-hosting/configuration.md) — harness connection, Web URL, and environment.
- [Remote access](self-hosting/relay.md) — the Cloudflare relay.
- [Updates and backups](self-hosting/updates.md) — rebuild, update, and restore.
- [Orchestration](self-hosting/orchestration.md) — optional pipelines and Clara Lab.

## Work on Clara

Architecture, feature specs, and implementation notes live in the
[developer documentation](/internals/). They describe how Clara works, not how to
use it.
