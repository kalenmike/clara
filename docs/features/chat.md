# Chat

## Summary

The chat view is where people read and steer an OpenCode session. It shows the
conversation history, streams new output as it arrives, exposes tool activity,
and pauses for approval when the agent needs permission.

## User flow

1. Open a session from the sidebar or project page.
2. Clara loads the newest messages and scrolls to the bottom.
3. Type in the composer and press Enter; the prompt appears immediately and the
   header switches to "running".
4. Assistant text and reasoning stream in; reasoning stays collapsed until it is
   opened.
5. Tool calls appear as cards that expand to show input, output, duration, and
   status.
6. If a tool needs approval, a permission panel appears above the composer with
   allow once, always allow, and reject.
7. Use **Stop** or Escape to interrupt a run; use **Queue** to send another
   message while the agent is working.
8. When the run finishes the header returns to "idle" and usage settles.

## Core business rules

1. The event stream is authoritative during a run; persisted history is loaded on
   open and refetched on idle to reconcile.
2. Streaming text and reasoning are appended to ordered content parts, and tool
   cards are keyed by tool call ID.
3. Permissions block tool execution until the person chooses once, always, or
   reject.
4. The history request is capped at the newest 100 messages.
5. Unknown event types are ignored so a newer server does not break the view.

## Edge cases

- **Provider auth failure** — the assistant message shows the structured error
  (for example "No cookie auth credentials found") instead of a blank reply.
- **Stream disconnect** — the header loses its live state and the event provider
  reconnects with backoff; a refetch on idle repairs missed content.
- **Session missing** — a "Session not found" state offers the project page.
- **Empty session** — the composer and a short hint replace the message list.
- **Tool failure** — the card opens by default and shows the error message.
- **Long tool output** — input and output clamp to a scrollable height.
- **Permission rejected** — the request disappears and the agent continues or
  fails according to its own behavior.
- **Rapid session switching** — each session keeps its own store snapshot; the
  visible view only reads the active session.
- **Message count above 100** — older messages are not reachable in the UI yet.

## Out of scope

- Diff review, revert, fork, or snapshot browsing
- Todos, worktrees, PTY/terminal, or MCP management
- Editing or deleting individual messages
- Message search inside a session

## Known gaps

- The oldest messages in a long session cannot be loaded.
- `idle` system messages are hidden to reduce noise.
- Form answers support the common field types but not conditional `when` rules.
- The "scroll to bottom" control can appear while the list is already at the
  bottom during initial measurement.

## Technical appendix

<details>
<summary>Routes, data, and references</summary>

- Route: `/p/:projectId/s/:sessionId`
- History: `client.message.list({ sessionID, order: 'desc', limit: 100 })`,
  reversed for display
- Stream: `client.event.subscribe()` through `EventProvider`
- Send: `client.session.prompt({ sessionID, text, files, delivery })`
- Interrupt: `client.session.interrupt({ sessionID })`
- Approvals: `client.permission.request.list`, `client.permission.reply`
- Forms: `client.session.form.list`, `client.session.form.reply`
- Store: `src/features/chat/chat-store.ts`
- Related: [capabilities](capabilities.md), [composer](composer.md)

</details>
