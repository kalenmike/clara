# Pair terminal

## Summary

The pair terminal is an optional, read-only view that follows the selected
session like a terminal. It shows the commands the agent runs, streams their
output as it arrives, and lists other tool activity in a compact form so a
person can watch the agent work without opening every tool card.

## User flow

1. Open a session and press the panel button in the chat header and select the
   **Terminal** tab, or press `ctrl+x` then `` ` ``.
2. On wide screens the right panel opens on the **Terminal** tab at the panel's
   remembered width; drag the panel's left edge to widen it. On narrow screens it
   opens as a full-width sheet.
3. Watch each user prompt appear as a dim marker, followed by the agent's
   commands as `$ command` lines.
4. Command output streams in below the command while it runs.
5. Read the status line under each command: running, done, failed, exit code, and
   duration.
6. Read other tool calls as one-line activity entries such as `read` or `edit`.
7. Scroll up to inspect earlier output. Following pauses automatically; press
   **Jump to live** to resume.
8. Switch sessions and see that session's own log. Switch back to **Info** or
   **Git** in the same panel at any time.

## Core business rules

1. The terminal is read-only. It never sends commands, keystrokes, stdin, or
   permission decisions.
2. Shell commands are the primary content: the command, its streamed output, its
   final output, exit status, and duration. Other tools appear as compact
   activity lines without their full output.
3. The event stream is authoritative during a run. Persisted history backfills
   completed commands when the view opens, and a refetch on idle reconciles the
   log.
4. Terminal visibility is independent of the chat's internal-output toggle. The
   terminal shows commands even when the chat hides tool cards.
5. Output is rendered as text. ANSI escape sequences and control characters are
   stripped, carriage-return overwrites collapse to the final visible line, and
   each command keeps at most the last 400 lines.
6. The view is scoped to the selected session. Switching sessions never carries
   the previous session's commands into the new view.
7. The log follows the newest output until the person scrolls up. New output
   never forces the scroll position while following is paused.

## Edge cases

- **No progress events** — if a server or tool does not publish live progress,
  output appears when the command finishes.
- **Failed command** — the log shows the error and a non-zero exit status when
  the server provides it.
- **Very long output** — the log keeps the newest lines and prepends a truncation
  notice.
- **ANSI or full-screen output** — colors and cursor sequences are stripped;
  progress bars may collapse to their final visible line.
- **Stream disconnected** — the header shows `reconnecting`; finishing events or
  the idle refetch repair the log.
- **Scrolled up** — following pauses and **Jump to live** appears until pressed.
- **Empty session** — the terminal shows a waiting state with a `$` prompt.
- **Permission pending** — the command may appear prepared or running, but
  approval remains in the chat's permission panel.
- **Mobile sheet open** — the chat and approval prompt are behind the sheet until
  it is closed.
- **Long session** — commands in pages the chat has not loaded yet are not
  available until the conversation loads them.
- **Older activity dropped** — when the log exceeds its entry cap, the top of the
  terminal says earlier activity is not shown.
- **Session deleted** — the chat navigates away and the terminal unmounts.

## Out of scope

- Interactive PTY sessions, typing into a shell, or sending stdin
- Full terminal emulation: cursor positioning, alternate screen, mouse support,
  or a terminal package such as xterm.js
- Running, cancelling, or approving anything from the terminal
- Full output for non-shell tools
- Exporting, searching, or persisting terminal output beyond session history
- Resizing the terminal panel independently of the side panel
- Custom filters, themes, or per-session terminal preferences

## Known gaps

- Live `!` shell messages are reconciled through the chat message refetch rather
  than a dedicated shell event path.
- Only messages loaded by the chat are available for backfill; older pages
  appear as the conversation loads them.
- Non-shell tool output is summarized, not streamed.
- The server may truncate command output before it reaches Clara.

## Technical appendix

<details>
<summary>Routes, data, and references</summary>

- Route: `/p/:projectId/s/:sessionId`; the terminal shares the chat route.
- Toggle: `ctrl+x` then `` ` `` through `src/hooks/use-keybinds.ts`, or select
  the **Terminal** tab in the side panel.
- Panel: `src/components/layout/side-panel.tsx` adds the **Terminal** tab to the
  existing Info and Git tabs. The tab is stored in `clara.sidePanelTab`. The
  panel width is shared across tabs and stored in `clara.sidePanelWidth`.
- Live data: `client.event.subscribe()` through `EventProvider`.
- Command lifecycle: `session.tool.input.started`, `session.tool.input.ended`,
  `session.tool.called`, `session.tool.progress`, `session.tool.success`,
  `session.tool.failed`.
- Streaming output: the shell tool publishes accumulated output in
  `session.tool.progress` metadata; `chatStore` merges it into the running tool
  state.
- History: `client.message.list({ sessionID, order: 'desc', limit: 100 })` for
  the newest page, reversed for display; older pages are loaded with the chat's
  cursor pagination. Shell messages use the `shell` message type.
- Log builder: `src/features/chat/terminal-log.ts`.
- View: `src/components/chat/pair-terminal.tsx`.
- Store: `src/features/chat/chat-store.ts`.
- Related: [chat](chat.md), [session info](session-info.md), [git](git.md),
  [shortcuts](shortcuts.md), [capabilities](capabilities.md)

</details>
