# Chat

## Summary

The chat view is where people read and steer an OpenCode session. It shows the
conversation history, streams new output as it arrives, exposes tool activity,
and pauses for approval when the agent needs permission. Messages are laid out
like an email thread: each one is full width and left aligned, with a small
avatar, the sender name, and a timestamp above the content, separated by a
divider. Older messages start collapsed so the newest reply stays in view, and
either header can be folded with a click. Assistant headers show the model name
and the agent that produced the reply. A header toggle reveals internal output
such as thinking, tool calls, and commands; internal output is hidden by
default. When a Plan run finishes, a plan-ready card appears above the thread so
the person can steer the plan or hand off to Build. A session saved as a draft
shows its queued user message in the thread and a Start card above it.

## User flow

1. Open a session from the sidebar or project page. A session with no messages
   and no saved draft shows the empty session view instead of the message list;
   its **Start conversation** button opens the reply window in the last-used
   size (expanded by default). Creating a new session opens that window
   automatically.
2. Clara loads the newest messages and scrolls to the bottom.
3. Click **Reply**, type in the reply window, and press Enter; the prompt appears
   immediately and the header switches to "running".
4. Assistant text streams in. Turn on internal output in the header to see
   reasoning, tool calls, shell commands, and system notices. Open the
   **Terminal** tab in the right panel, or press `ctrl+x` then `` ` ``, to watch
   commands and their streamed output separately.
5. When the run is idle, a bright **Done** button appears next to the floating
   Reply button. Clicking it plays an optional completion chime, briefly
   celebrates, appends `[DONE]` to the session title, archives the session, and
   returns to the start view.
6. On an archived session, **Reopen** replaces Done next to Reply. Clicking it
   clears the archive state and leaves the title, including any `[DONE]` suffix,
   as it is.
7. Tool calls appear as cards that expand to show input, output, duration, and
   status when internal output is on.
8. If a tool needs approval, a permission panel appears above the message list
   with allow once, always allow, and reject.
9. Use **Stop** or Escape to interrupt a run; sending another message while the
   agent is working steers the active run.
10. When the run finishes the header returns to "idle" and usage settles.
11. When a Plan run ends with a final reply, a plan-ready card appears above the
    thread. **Steer** opens the reply window for adjustments; **Build** switches
    to Build and sends `Confirmed`.
12. Open a session with a saved draft. The queued user message appears in the
    thread and a Start card appears above it. Click **Start** to send `Start`,
    deliver the draft, and begin the run.
13. Click a message header to fold it; a folded message shows its header and the
    first line only. The button in the top-right folds or opens every message.
14. Click the eye button next to it to show or hide internal output. The choice
    is remembered across sessions and reloads.

## Core business rules

1. The event stream is authoritative during a run; persisted history is loaded on
   open and refetched on idle to reconcile.
2. Streaming text and reasoning are appended to ordered content parts, and tool
   cards are keyed by tool call ID.
3. Permissions block tool execution until the person chooses once, always, or
   reject.
4. History loads the newest 100 messages first. Scrolling near the top fetches
   older pages with the server's cursor and keeps the view anchored to the first
   visible message.
5. Unknown event types are ignored so a newer server does not break the view.
6. Each message renders as a full-width row with a `U`/`A` avatar, sender name,
   timestamp, and a divider. Assistant headers show the model name and an agent
   chip with the bot icon. Token and cost details appear in a muted footer under
   the content; system events render as avatar-less notes.
7. The newest message starts expanded and every earlier message starts collapsed.
   When a new message arrives, the previous one collapses again unless it was
   folded or opened by hand.
8. A collapsed message shows only its header and a one-line preview: the prompt's
   first line, the first assistant text, or the shell command. Internal reasoning
   and tool names only appear in the preview when internal output is on. Usage
   details stay hidden until the message is opened.
9. Collapse state lives in memory for the open session; switching sessions or
   reloading returns to the newest-expanded default.
10. Internal output is hidden by default. The header toggle controls reasoning,
    tool calls, shell commands, and synthetic, skill, and compaction notices. The
    preference is stored in `localStorage` and shared across sessions. A failed
    turn is never treated as internal output: its error stays visible at every
    detail level.
11. Agent-switched and system-reminder messages are never rendered; the agent is
    shown on the assistant header instead.
12. Done is available only while the reply window is closed and the agent is
    idle. On a session with messages it archives the session on the server,
    appends `[DONE]` unless a `[DONE]` or `(DONE)` suffix is already present,
    and returns to the start view. On an empty session it deletes the session
    instead. The button is hidden while the agent is running and for sessions
    that are already archived. Empty sessions hide the floating Reply button;
    the reply window opens in the last-used size from the empty view action. The
    button plays the UI completion chime when **UI sounds** is on; its animation
    and success toast do not depend on sound settings. The start view returns
    after a short celebration delay.
13. Archived sessions show Reopen instead of Done next to Reply. Reopen clears
    the server's archived flag without renaming the session, so the session
    returns to its mailbox section with its `[DONE]` title intact.
14. The plan-ready card appears only while the session is idle, the session agent
    is Plan, and the newest user or assistant message is a Plan reply that
    finished with `stop` and no error. It is hidden while the reply window is
    open and on archived sessions. Build switches the agent before sending
    `Confirmed`, and both requests disable the buttons while they are in flight.
15. The Start card appears only while the session is idle, not archived, and the
    server reports pending user items in the session inbox. Pending inbox user
    messages are merged into the thread by message ID, so a draft is visible
    before it is delivered and disappears cleanly once it becomes a real
    message. Start sends `Start` with steering and disables while the request is
    in flight.

## Edge cases

- **Provider failure** — a turn that fails at the provider (auth, quota, rate
  limit) shows its structured error, HTTP status, and a plain-language next step
  instead of a blank reply, even when internal output is off. A toast names the
  failure, and the error stays attached to the assistant message after a reload.
- **Stream disconnect** — the sidebar badge turns into a **Retry** control, the
  provider reconnects with backoff, and a successful reconnect refetches the
  queries that missed events would have invalidated.
- **Session missing** — a "Session not found" state offers the project page.
- **Empty session** — the empty session view replaces the message list, the
  floating Reply button is hidden, and Start conversation opens the reply window
  in the last-used size.
- **Saved draft** — the draft is a pending inbox item, not a projected message.
  It is rendered in the thread and the Start card appears; Done archives rather
  than deletes because the draft counts as a message.
- **Inbox lookup fails** — the draft and Start card are unavailable, but the rest
  of the chat still loads.
- **Start fails** — the draft stays queued and Start can be retried.
- **Draft delivered** — the pending item moves into the transcript and the Start
  card disappears.
- **Message lookup fails** — the view reports the failure and hides Done instead
  of offering to delete the session.
- **Tool failure** — the card opens by default and shows the error message.
- **Long tool output** — input and output clamp to a scrollable height.
- **Permission rejected** — the request disappears and the agent continues or
  fails according to its own behavior.
- **Rapid session switching** — each session keeps its own store snapshot; the
  visible view only reads the active session.
- **Very long conversation** — older pages load as the list approaches the top;
  the first visible message stays in place while pages are prepended.
- **History changes** — compaction or a revert clears cached older pages and
  reloads the newest page from the server.
- **No preview text** — a message with no text falls back to the first tool name,
  an attachment count, or just its header.
- **Streaming while collapsed** — a message folded by hand stays folded as text
  streams in; the header button opens it again.
- **Tool-only reply** — with internal output off, an assistant message that only
  contains reasoning or tool calls is hidden. While it is still streaming, the
  newest message keeps a “Thinking…” indicator.
- **Plan reply without `stop`** — a Plan run that ends on a tool call, an error,
  or a non-stop finish does not show the plan-ready card.
- **Stale plan handoff** — the card requires the session agent and the newest
  reply to be Plan; switching agents or opening an archived session hides it.
- **Build request fails** — a failed switch leaves the card in place; if the
  switch succeeds but `Confirmed` fails, a toast asks the person to send it from
  the reply box.
- **System notes** — skill, compaction, and synthetic events have no header and
  are never collapsed. Model and location switches still render as notes; agent
  switches are replaced by the header chip.
- **Mixed collapse state** — the header button folds every visible message first;
  pressing it again opens them all. Hidden internal messages are not counted.
- **Done while running** — the button is hidden until the agent is idle.
- **Done on an empty session** — the session is deleted and the start view
  returns; no `[DONE]` title is written.
- **Done on an archived session** — the button is hidden and Reopen is shown
  instead; the chat remains readable.
- **UI sounds off** — Done archives silently, but the button animation and
  success toast still play. Inbox alert sounds are controlled separately.
- **Reopen** — clears the archived flag, leaves the title untouched, and returns
  to the same view without navigating away.
- **Title already suffixed** — `[DONE]` and `(DONE)` titles are not suffixed
  again when archived, and reopening keeps them as they are.

## Out of scope

- Diff review, revert, fork, or snapshot browsing
- Todos, worktrees, interactive PTY/terminal sessions, or MCP management
- Editing or deleting individual messages
- Message search inside a session

## Known gaps

- `idle` system messages are hidden to reduce noise.
- Form answers support the common field types but not conditional `when` rules.
- The "scroll to bottom" control can appear while the list is already at the
  bottom during initial measurement.

## Technical appendix

<details>
<summary>Routes, data, and references</summary>

- Route: `/p/:projectId/s/:sessionId`
- Start view: `/`
- History: `client.message.list({ sessionID, order: 'desc', limit: 100 })` for
  the newest page, reversed for display; older pages use
  `client.message.list({ sessionID, cursor, limit: 100 })` and are merged by ID
  into `chatStore`
- Stream: `client.event.subscribe()` through `EventProvider`
- Send: `client.session.prompt({ sessionID, text, files, delivery })`
- Pending drafts: `client.session.inbox.list({ sessionID })`, merged into the
  thread by message ID
- Start draft: `client.session.prompt({ sessionID, text: 'Start', delivery: 'steer' })`
- Start card: `src/components/chat/draft-start-panel.tsx`
- Done: `client.session.update({ sessionID, title, archived: true })`; the
  button is `src/components/chat/done-button.tsx` and the chime is
  `playDoneSound` in `src/features/notifications/sounds.ts`
- Reopen: `client.session.update({ sessionID, archived: false })` — no title
- Done on empty: `client.session.remove({ sessionID })`
- Interrupt: `client.session.interrupt({ sessionID })`
- Approvals: `client.permission.request.list`, `client.permission.reply`
- Forms: `client.session.form.list`, `client.session.form.reply`
- Plan handoff: `src/features/chat/plan-ready.ts`,
  `src/components/chat/plan-ready-panel.tsx`
- Plan handoff APIs: `client.session.switchAgent({ sessionID, agent: 'build' })`,
  then `client.session.prompt({ sessionID, text: 'Confirmed', delivery: 'steer' })`
- Reply event: `clara:open-reply` opens the reply window in normal mode
- Pair terminal: `src/features/chat/terminal-log.ts`,
  `src/components/chat/pair-terminal.tsx`, and the `session.tool.progress`
  event. See [pair terminal](pair-terminal.md).
- Store: `src/features/chat/chat-store.ts`
- Collapse state: `src/hooks/use-collapsed-messages.ts`
- Internal-output visibility: `src/features/chat/message-visibility.ts`
- Internal-output preference: `clara.internalMessages` in `localStorage`
- Related: [capabilities](capabilities.md), [composer](composer.md)

</details>
