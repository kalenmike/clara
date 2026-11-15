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
   second version of the same subject. A topic that outgrows one page becomes a
   folder with an `index.md`, and that index is the canonical entry for the
   topic.
2. **Every document is listed in an index.** This root index lists every flat
   page and every topic folder's `index.md`. A folder index lists its own
   children; do not repeat those children here. A new document is not merged
   until it has a row in the right index.
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

| Document                                                | Read when…                                                      |
| ------------------------------------------------------- | --------------------------------------------------------------- |
| [overview.md](architecture/overview.md)                 | You need the workspace, modes, auth model, or event flow        |
| [api.md](architecture/api.md)                           | You are working on the hub API, OpenAPI, or read-only MCP       |
| [relay.md](architecture/relay.md)                       | You are working on the Worker, Durable Object, or remote access |
| [e2ee.md](architecture/e2ee.md)                         | You are working on pairing, key derivation, or encrypted frames |
| [harness-protocol.md](architecture/harness-protocol.md) | You are working on the harness protocol frames or transport     |

### Standards

| Document                               | Read when…                                        |
| -------------------------------------- | ------------------------------------------------- |
| [development.md](development.md)       | You are developing Clara or running its dev tools |
| [ui.md](ui.md)                         | You are adding or changing a shared component     |
| [features/GUIDE.md](features/GUIDE.md) | You are writing or updating a feature spec        |

### Features

| Document                                                  | Read when…                                                              |
| --------------------------------------------------------- | ----------------------------------------------------------------------- |
| [capabilities.md](features/capabilities.md)               | You need to know what ships, what is partial, or what is missing        |
| [connection.md](features/connection.md)                   | You are working on pairing a client or the encrypted connection         |
| [hub-service.md](features/hub-service.md)                 | You are working on the hub executable, ports, or service lifecycle      |
| [harness-adapters.md](features/harness-adapters.md)       | You are working on harness adapters, install, or adapter transport      |
| [session-panel.md](features/session-panel.md)             | You are working on the Info, Git, Terminal, or Plan side panel          |
| [chat/index.md](features/chat/index.md)                   | You are working on chat, approvals, the composer, or fork/forward       |
| [sessions/index.md](features/sessions/index.md)           | You are working on the project browser or session lifecycle             |
| [panel/index.md](features/panel/index.md)                 | You are working on the hub panel, its controls, or its network view     |
| [orchestration/index.md](features/orchestration/index.md) | You are working on the engine, packages, runs, or Clara Lab             |
| [install.md](features/install.md)                         | You are working on install, updates, caching, or offline behavior       |
| [desktop.md](features/desktop.md)                         | You are working on the native desktop shell or its build                |
| [settings.md](features/settings.md)                       | You are working on the Settings page, tabs, or simplified view          |
| [sync.md](features/sync.md)                               | You are working on client settings sync, its protocol, or the Sync tab  |
| [theme.md](features/theme.md)                             | You are working on appearance, color themes, or light/dark mode         |
| [models.md](features/models.md)                           | You are working on model visibility, the Models tab, or model details   |
| [notifications.md](features/notifications.md)             | You are working on Inbox alerts, desktop notifications, or alert sounds |
| [shortcuts.md](features/shortcuts.md)                     | You are working on keyboard behavior                                    |
