# Documentation

This is the only index for repository documentation. If a document is not listed
here, it is not part of the canonical set.

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

## Index

### Architecture

| Document                                | Read when…                                                      |
| --------------------------------------- | --------------------------------------------------------------- |
| [overview.md](architecture/overview.md) | You need the workspace, modes, auth model, or event flow        |
| [relay.md](architecture/relay.md)       | You are working on the Worker, Durable Object, or remote access |
| [e2ee.md](architecture/e2ee.md)         | You are working on pairing, key derivation, or encrypted frames |

### Standards

| Document                               | Read when…                                 |
| -------------------------------------- | ------------------------------------------ |
| [features/GUIDE.md](features/GUIDE.md) | You are writing or updating a feature spec |

### Features

| Document                                      | Read when…                                                               |
| --------------------------------------------- | ------------------------------------------------------------------------ |
| [capabilities.md](features/capabilities.md)   | You need to know what ships, what is partial, or what is missing         |
| [install.md](features/install.md)             | You are working on install, updates, caching, or offline behavior        |
| [connection.md](features/connection.md)       | You are working on connecting Clara to an OpenCode server                |
| [pairing.md](features/pairing.md)             | You are working on QR/code pairing, device storage, or key rotation      |
| [sessions.md](features/sessions.md)           | You are working on the project/session browser                           |
| [chat.md](features/chat.md)                   | You are working on messages, streaming, tools, or permissions            |
| [fork.md](features/fork.md)                   | You are working on forking a session or forwarding a message             |
| [pair-terminal.md](features/pair-terminal.md) | You are working on the read-only terminal that follows a running session |
| [composer.md](features/composer.md)           | You are working on the reply window, commands, mentions, or attachments  |
| [session-info.md](features/session-info.md)   | You are working on cost, tokens, context, or message counts              |
| [notifications.md](features/notifications.md) | You are working on Inbox alerts, desktop notifications, or alert sounds  |
| [theme.md](features/theme.md)                 | You are working on appearance, color themes, or light/dark mode          |
| [git.md](features/git.md)                     | You are working on the branch and change summary in the right panel      |
| [shortcuts.md](features/shortcuts.md)         | You are working on keyboard behavior                                     |
