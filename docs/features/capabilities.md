# Capabilities

What Clara does today. This page is the single source of truth for shipped
scope; feature docs describe behavior, not status.

## Shipped

| Area         | What works                                                                                                                                      |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Connection   | Auto-detects the local OpenCode service through the dev proxy; manual URL + password for any OpenCode 2 server; optional remembered credentials |
| Projects     | Lists every project the server knows, with path and last activity; remembers the last project                                                   |
| Sessions     | Lists sessions per project, searches, groups by date, creates, renames, archives, deletes                                                       |
| Chat         | Renders the latest 100 messages: user prompts, assistant text, reasoning, tool calls, shell, skills, compaction, and system notes               |
| Streaming    | Live text and reasoning deltas, tool progress, usage updates, running/idle status, and automatic reconnect                                      |
| Sending      | Sends prompts with text and inline file attachments; queues messages while a run is active; interrupts a run                                    |
| Agents       | Lists primary agents, switches the session agent, cycles with Tab                                                                               |
| Models       | Searchable model picker across providers, switches the session model, changes variants                                                          |
| Commands     | `/` palette with names and descriptions; runs commands in the session                                                                           |
| Mentions     | `@` palette for files, agents, skills, and references                                                                                           |
| Session info | Context usage against the model limit, cost, token breakdown, message counts, timing, model limits                                              |
| Approvals    | Permission prompts with allow once, always allow, and reject                                                                                    |
| Questions    | Form prompts with string, number, boolean, multiselect, and external fields                                                                     |
| Shortcuts    | OpenCode-style leader key (`ctrl+x`) shortcuts, Tab agent cycle, `ctrl+t` variant cycle, Escape interrupt                                       |
| Theme        | Light, dark, and system                                                                                                                         |

## Partial

- **Session list** returns the newest 50 sessions; there is no infinite scroll.
- **Chat history** loads the newest 100 messages; older pages are not loaded yet.
- **Command preview** shows only the name and description because the server does
  not expose command templates.
- **Mentions** insert `@path` text references; they do not upload file contents.
- **Connection** holds one server at a time; there are no saved profiles.

## Not built

- Pairing links or cookie-based browser auth
- Diff review, todos, worktrees, PTY/terminal, MCP and plugin management
- A production proxy for the local service (the dev proxy is Vite-only)
- Simultaneous connections to multiple servers
- Session sharing, export, or import
- Notifications outside the browser tab

## Related

- [connection.md](connection.md)
- [sessions.md](sessions.md)
- [chat.md](chat.md)
- [composer.md](composer.md)
- [session-info.md](session-info.md)
- [shortcuts.md](shortcuts.md)
