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
default. Actions Clara triggers on the person's behalf — requesting a plan,
refreshing it, and starting work — and the person's answers to an agent
question appear as compact system rows in the thread rather than as if the
person had typed them. When a
Plan run finishes, a plan-ready card appears above the thread so the person can
adjust the plan or start work. A session with no messages shows a
dedicated New message view, and a session saved as a draft shows its queued user
message in the thread and a Start card above it. The header can fork the whole
brief, and each user or assistant message has fork and forward actions; see
[fork.md](fork.md).

## User flow

1. Open a session from the sidebar or project page. A session with no messages
   and no saved draft shows a dedicated New message view instead of the message
   list. Creating a new session opens the composer automatically in the
   last-used size (expanded by default). Opening an empty draft with locally
   saved text opens the composer too; otherwise press **New** to reopen it.
2. Clara loads the newest messages and opens the thread with the top of the
   newest message at the top of the view, directly below the header and any
   request panel above the thread, so a long reply is readable from its first
   line. A session that is still running keeps following the newest output
   instead. The down-arrow control jumps to the newest output.
3. Click **Reply**, type in the reply window, and press Enter; the prompt appears
   immediately and the header switches to "running".
4. Assistant text streams in. Turn on internal output in the header to see
   reasoning, tool calls, shell commands, and untagged system notices. Open the
   **Terminal** tab in the right panel, or press `ctrl+x` then `` ` ``, to watch
   commands and their streamed output separately.
5. When the run is idle, a bright **Done** button appears next to the floating
   Reply button. Clicking it plays an optional completion chime, briefly
   celebrates, archives the session without changing its title, and returns to
   the start view. On an empty draft, a simple **Delete** button replaces Done
   and **New** replaces Reply; Delete removes the session immediately without
   the celebration or chime.
6. On an archived or snoozed session, **Reopen** replaces Done next to Reply.
   Clicking it clears the archive and snooze state as applicable and leaves the
   title untouched.
7. Tool calls appear as cards that expand to show input, output, duration, and
   status when internal output is on.
8. If a tool needs approval, a permission panel appears above the message list
   with allow once, always allow, and reject. A collapsed **Agent's thinking**
   option expands to the reasoning that led to the request.
9. Use **Stop** or Escape to interrupt a run; sending another message while the
   agent is working steers the active run.
10. When the run finishes the header returns to "idle" and usage settles.
11. When a Plan run ends with a final reply, a plan-ready card appears above the
    thread. **Adjust Plan** opens the reply window for changes; **Start Work**
    switches to the working agent and sends a short synthetic handoff, which
    appears as a **User confirmed. Starting work.** system row.
12. Open a session with a saved draft. The queued user message appears in the
    thread and a Start card appears above it. Click **Start** to send `Start`,
    deliver the draft, and begin the run.
13. Answer an agent question. The form disappears when submitted, and the
    question-and-answer summary is appended to the thread as a **Answered N
    questions** system row. The event is derived from the completed `question`
    tool, so it survives reloads without another request.
14. Click a message header to fold it; a folded message shows its header and the
    first line only. The button in the top-right folds or opens every message.
15. Click the eye button next to it to show or hide internal output. The choice
    is remembered across sessions and reloads.
16. The header's more menu can **Snooze session** or **Remove from Snoozed**.
    Snoozing moves the session to the sidebar's Snoozed bucket and replaces Done
    with Reopen.

## Core business rules

1. The event stream is authoritative during a run; persisted history is loaded on
   open and refetched on idle to reconcile.
2. Streaming text and reasoning are appended to ordered content parts, and tool
   cards are keyed by tool call ID.
3. Permissions block tool execution until the person chooses once, always, or
   reject. Each prompt offers a collapsed **Agent's thinking** disclosure. It
   uses the request's tool source to show the reasoning that came before that
   tool call in the same assistant step, falls back to the newest assistant step
   when the source is unavailable, and stays hidden when no reasoning was
   recorded. It is available whether or not internal output is on.
4. History loads the newest 100 messages first. Opening a thread positions the
   top of the newest message at the top of the view unless the session is
   running, in which case the view follows new output; scrolling near the top
   fetches older pages with the server's cursor and keeps the view anchored to
   the first visible message. A request panel above the thread (permission,
   question form, plan-ready, or draft start) is in normal document flow, so the
   newest message starts just below it without any extra offset.
5. Unknown event types are ignored so a newer server does not break the view.
6. Each message renders as a full-width row with a `U`/`A` avatar, sender name,
   timestamp, and a divider. Assistant headers show the model name and an agent
   chip with the bot icon. Token and cost details appear in a muted footer under
   the content. System events render as compact divider rows with an icon, a
   label, a timestamp, and optional expandable detail; they never look like a
   prompt the person typed.
7. The newest prompt or reply starts expanded and every earlier reply starts
   collapsed. An assistant step does not count as a reply until it has text (or
   fails), so the prompt that started a run stays expanded while the agent is
   thinking or calling tools. When the agent replies, the previous message
   collapses again unless it was folded or opened by hand.
8. A collapsed message shows only its header and a one-line preview: the prompt's
   first line, the first assistant text, or the shell command. Internal reasoning
   and tool names only appear in the preview when internal output is on. Usage
   details stay hidden until the message is opened.
9. Collapse state lives in memory for the open session; switching sessions or
   reloading returns to the newest-expanded default.
10. Internal output is hidden by default. The header toggle controls reasoning,
    tool calls, shell commands, and untagged synthetic, skill, and compaction
    notices. Clara's own system events and question-answer summaries stay visible
    at every detail level. The preference is stored in `localStorage` and shared
    across sessions. A failed turn is never treated as internal output: its error
    stays visible at every detail level.
11. Agent-switched and system-reminder messages are never rendered; the agent is
    shown on the assistant header instead. Clara's one-click actions write
    synthetic input with a human-facing description, so they appear as system
    events instead of fake user prompts.
12. Done is available only while the composer is closed, the agent is idle, and
    the session has a message. It archives the session on the server without
    changing its title and returns to the start view. An empty, non-archived
    draft shows a simple **Delete** action instead: it removes the session
    immediately without the celebration, chime, or redirect delay. Empty drafts
    show **New** in place of Reply; New opens the composer in the last-used
    size, and opening an empty draft with locally saved composer text opens it
    automatically. The New message view itself has no action button. The Done
    button plays the UI completion chime when **UI sounds** is on; its animation
    and success toast do not depend on sound settings. The start view returns
    after a short celebration delay.
13. Archived or snoozed sessions show Reopen instead of Done next to Reply.
    Reopen clears the server's archived flag and any snooze metadata without
    renaming the session, so the session returns to its mailbox section with its
    title intact. Archived wins when both flags are present.
14. The plan-ready card appears only while the session is idle, the session agent
    is Plan, and the newest user or assistant message is a Plan reply that
    finished with `stop` and no error. It is hidden while the reply window is
    open and on archived sessions. Build switches the agent before sending
    `Confirmed`, and both requests disable the buttons while they are in flight.
    Once `Confirmed` is sent, Build advances the Monitor Inbox like Send does.
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
- **Empty draft** — the New message view replaces the message list, **New**
  replaces Reply, and **Delete** replaces Done. The composer opens
  automatically when locally saved text exists.
- **Draft restored** — reopening an empty draft with locally saved text opens
  the composer with that text; after closing, the New button shows a draft dot.
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
  newest message keeps a “Thinking…” indicator and the prompt that started the
  run stays expanded until the agent produces text.
- **Prompt sent to a running agent** — the new prompt takes over as the expanded
  message; the previous reply collapses unless it was opened by hand.
- **Plan reply without `stop`** — a Plan run that ends on a tool call, an error,
  or a non-stop finish does not show the plan-ready card.
- **Stale plan handoff** — the card requires the session agent and the newest
  reply to be Plan; switching agents or opening an archived session hides it.
- **Start Work request fails** — a failed switch leaves the card in place; if
  the switch succeeds but the handoff cannot be sent, a toast asks the person to
  send a message from the reply box, and Monitor Inbox does not advance.
- **System events** — Clara's plan, update, start-work, and question-answer
  events have no avatar and are never collapsed. Skill, compaction, and untagged
  synthetic notices remain internal output. Model and location switches still
  render as notes; agent switches are replaced by the header chip.
- **Mixed collapse state** — the header button folds every visible message first;
  pressing it again opens them all. Hidden internal messages are not counted.
- **Done while running** — the button is hidden until the agent is idle.
- **Delete on an empty draft** — the session is removed immediately and the
  start view returns; the title is left untouched.
- **Done on an archived or snoozed session** — the button is hidden and Reopen
  is shown instead; the chat remains readable.
- **Snoozing while running** — the session moves to Snoozed, but Reopen stays
  hidden until the run finishes.
- **UI sounds off** — Done archives silently, but the button animation and
  success toast still play. Inbox alert sounds are controlled separately.
- **Reopen** — clears the archived flag and any snooze metadata, leaves the title
  untouched, and returns to the same view without navigating away.
- **Title preserved on archive** — Done archives the session as-is, so existing
  titles, including legacy `[DONE]` and `(DONE)` suffixes, are never changed.
- **Narrow viewport** — the session title keeps its own row and ellipsizes; the
  internal-output, collapse-all, side-panel, and more actions move into the Clara
  app bar above it instead of sharing the title row. Every icon control in the
  mobile chrome uses a 44px touch target and a 20px glyph, while the desktop
  header keeps its compact 32px controls.

## Out of scope

- Diff review, revert, or snapshot browsing
- Todos, worktrees, interactive PTY/terminal sessions, or MCP management
- Editing or deleting individual messages
- Message search inside a session

## Known gaps

- `idle` system messages are hidden to reduce noise.
- Form answers support the common field types but not conditional `when` rules.
- Question answers appear as system events; answers to non-question forms such as
  MCP elicitations are not logged in the thread.
- The opening position is settled over a few frames; scrolling in the first
  moments after opening can cancel the adjustment mid-measurement.
- A thread whose live status has not reached the client yet is treated as idle
  on open, so it starts at the top of the newest message instead of following
  output.

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
- New message view: `src/components/chat/draft-session-view.tsx`
- Done: `client.session.update({ sessionID, title, archived: true })`; the
  button is `src/components/chat/done-button.tsx` and the chime is
  `playDoneSound` in `src/features/notifications/sounds.ts`
- Snooze: `client.session.update({ sessionID, metadata: { ...existing, snoozed: true } })`
- Reopen: `client.session.update({ sessionID, archived: false, metadata? })` —
  clears archived and snooze metadata; no title change
- Delete empty draft: `client.session.remove({ sessionID })`; the button is
  rendered by `src/components/chat/reply-dock.tsx`
- Interrupt: `client.session.interrupt({ sessionID })`
- Approvals: `client.permission.request.list`, `client.permission.reply`;
  request thinking comes from `src/features/chat/permission-thinking.ts`
- Forms: `client.session.form.list`, `client.session.form.reply`
- Plan handoff: `src/features/chat/plan-ready.ts`,
  `src/components/chat/plan-ready-panel.tsx`; the Start Work button plays
  `playStartWorkSound` from `src/features/notifications/sounds.ts` when UI
  sounds are on
- Plan handoff APIs: `client.session.switchAgent({ sessionID, agent: 'build' })`,
  then `client.session.synthetic({ sessionID, text, description, metadata,
delivery: 'steer' })`
- System events: `client.session.synthetic` for one-click actions;
  `src/features/chat/system-events.ts` parses Clara metadata,
  `src/features/chat/questions.ts` derives Q&A events from the completed
  `question` tool, and `src/features/chat/timeline.ts` assembles rows
- System event UI: `src/components/chat/system-event-row.tsx`
- Reply event: `clara:open-reply` opens the reply window in normal mode
- Pair terminal: `src/features/chat/terminal-log.ts`,
  `src/components/chat/pair-terminal.tsx`, and the `session.tool.progress`
  event. See [pair terminal](pair-terminal.md).
- Store: `src/features/chat/chat-store.ts`
- Collapse state: `src/hooks/use-collapsed-messages.ts`
- Internal-output visibility: `src/features/chat/message-visibility.ts`
- Internal-output preference: `clara.internalMessages` in `localStorage`
- Local composer draft: `clara.draft.<sessionID>` in `localStorage`
- Related: [capabilities](capabilities.md), [composer](composer.md)

</details>
