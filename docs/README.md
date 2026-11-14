---
title: Internal documentation
slug: /
sidebar_position: 0
---

# Internal documentation

This is the canonical index for developer and agent documentation. If a document
is not listed here, it is not part of the internal set.

End-user documentation lives separately in `tools/docs/guide/`, is indexed at
`tools/docs/guide/index.md`, and is published at `/guide/`. Internal docs are
published at `/internals/` behind a visible "Internal" banner. They describe how
Clara works; the guide describes how to use it.

## Rules

1. **One canonical doc per topic.** Extend the existing document; never fork a
   second version of the same subject.
2. **Every document is listed here.** A new document is not merged until it has a
   row in the index below.
3. **Write docs only for what code cannot answer.** No meeting notes, no per-task
   plans, no research dumps.
4. **Delete superseded content.** Git history is the record.
5. **Relative links only, and every link must resolve.**
6. **Filenames are lowercase-with-dashes, in English.**
7. **Feature specs follow one shape.** Write and update them with
   [features/GUIDE.md](features/GUIDE.md).
8. **Feature records are not canonical docs.** `docs/records/NNN-slug.md` is
   append-only and intentionally unindexed. Historical records stay in Git
   history; the canonical docs describe current behaviour.
9. **Keep the two sets separate.** Developer and agent documentation stays here.
   End-user pages live in `tools/docs/guide/` and are listed in its own index.
   Do not publish internal implementation detail in the guide.
10. **User-visible behavior changes update the guide.** If people can see the
    change, edit the matching page under `tools/docs/guide/` in the same change.
11. **Guide pages never link into internal docs.** The guide may link to the
    developer documentation landing page, not to individual specs.
12. **Write platform behavior as harness and adapter.** The hub and web client
    are harness-neutral. Name a harness, such as OpenCode, only for its included
    adapter, its install commands, or a fact specific to that harness.

## Index

### Architecture

| Document                                | Read when…                                                      |
| --------------------------------------- | --------------------------------------------------------------- |
| [overview.md](architecture/overview.md) | You need the workspace, modes, auth model, or event flow        |
| [api.md](architecture/api.md)           | You are working on the hub API, OpenAPI, or read-only MCP       |
| [relay.md](architecture/relay.md)       | You are working on the Worker, Durable Object, or remote access |
| [e2ee.md](architecture/e2ee.md)         | You are working on pairing, key derivation, or encrypted frames |

### Standards

| Document                               | Read when…                                        |
| -------------------------------------- | ------------------------------------------------- |
| [development.md](development.md)       | You are developing Clara or running its dev tools |
| [features/GUIDE.md](features/GUIDE.md) | You are writing or updating a feature spec        |

### Features

| Document                                              | Read when…                                                               |
| ----------------------------------------------------- | ------------------------------------------------------------------------ |
| [capabilities.md](features/capabilities.md)           | You need to know what ships, what is partial, or what is missing         |
| [install.md](features/install.md)                     | You are working on install, updates, caching, or offline behavior        |
| [desktop.md](features/desktop.md)                     | You are working on the native desktop shell or its build                 |
| [hub-app.md](features/hub-app.md)                     | You are working on the hub tray app, Bun sidecar, or dynamic ports       |
| [connection.md](features/connection.md)               | You are working on connecting Clara to a harness                         |
| [harness-adapters.md](features/harness-adapters.md)   | You are working on harness adapters, pairing, or protocol transport      |
| [handshake-v4.md](features/handshake-v4.md)           | You are working on relay grants, the v4 handshake, or forward secrecy    |
| [pairing.md](features/pairing.md)                     | You are working on QR/code pairing, device storage, or key rotation      |
| [panel.md](features/panel.md)                         | You are working on the hub panel                                         |
| [hub-controls.md](features/hub-controls.md)           | You are working on feature toggles or the Go offline control             |
| [sync.md](features/sync.md)                           | You are working on client settings sync, its protocol, or the Sync tab   |
| [sessions.md](features/sessions.md)                   | You are working on the project/session browser                           |
| [activity.md](features/activity.md)                   | You are working on the project-scoped Inbox and Outbox activity view     |
| [chat.md](features/chat.md)                           | You are working on messages, streaming, tools, or permissions            |
| [fork.md](features/fork.md)                           | You are working on forking a session or forwarding a message             |
| [pair-terminal.md](features/pair-terminal.md)         | You are working on the read-only terminal that follows a running session |
| [composer.md](features/composer.md)                   | You are working on the reply window, commands, mentions, or attachments  |
| [models.md](features/models.md)                       | You are working on model visibility, the Models tab, or model details    |
| [session-info.md](features/session-info.md)           | You are working on cost, tokens, context, or message counts              |
| [notifications.md](features/notifications.md)         | You are working on Inbox alerts, desktop notifications, or alert sounds  |
| [theme.md](features/theme.md)                         | You are working on appearance, color themes, or light/dark mode          |
| [settings.md](features/settings.md)                   | You are working on the Settings page, tabs, or simplified view           |
| [git.md](features/git.md)                             | You are working on the branch and change summary in the right panel      |
| [orchestration.md](features/orchestration.md)         | You are working on the orchestration service, packages, or MCP adapter   |
| [orchestration-dsl.md](features/orchestration-dsl.md) | You are writing or changing a package, pipeline, step, or router         |
| [diagnostics.md](features/diagnostics.md)             | You are auditing run history, failures, alerts, or pipeline setup        |
| [maintenance.md](features/maintenance.md)             | You are rebuilding Clara or restarting its local services                |
| [lab.md](features/lab.md)                             | You are writing or debugging a custom orchestration package              |
| [shortcuts.md](features/shortcuts.md)                 | You are working on keyboard behavior                                     |
