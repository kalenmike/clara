# Chat

## Summary

The chat view is where people read and steer an OpenCode session. It shows the
conversation history, streams new output as it arrives, exposes tool activity,
and pauses for approval when the agent needs permission. Messages are laid out
like an email thread: each one is full width and left aligned, with a small
avatar, the sender name, and a timestamp above the content, separated by a
divider. Older messages start collapsed so the newest reply stays in view, and
either header can be folded with a click. Assistant headers show the model name
and the agent that produced the reply. A user message whose metadata says
`synthetic: true` is attributed to **Automation** with a Zap avatar instead of
the person, even when Clara management is off or excluded from the build. A
header toggle reveals internal output such as thinking, tool calls, and
commands; internal output is hidden by default, and the usage from hidden steps
rolls into the next visible reply so token and cost totals are not lost. Actions
Clara triggers on the person's behalf — requesting a plan,
refreshing it, and starting work — and the person's answers to an agent
question appear as compact system rows in the thread rather than as if the
person had typed them. OpenCode's mode reminders appear as collapsed
**System Reminder** rows, shown only when internal output is on, whose detail is
the reminder text without its tags.
When a
Plan run finishes, a plan-ready card appears above the thread so the person can
adjust the plan or start work. Every request card above the thread — plan-ready,
saved draft, agent question, or permission — starts expanded and folds
independently to a single header when the person wants it out of the way. A
session with no messages shows a
dedicated New message view, and a session saved as a draft shows its queued user
message in the thread and a Start card above it. A daemon worker session shown
while Clara management is on stays readable and stoppable but hides Reply,
Done, the composer, fork actions, and the plan-ready card; Forward, Reopen,
Archive, Delete, Stop, and the right-panel Plan request stay available. On
normal sessions the header can fork the whole brief, and each user or assistant
message has fork and forward actions; an assistant reply can also enter a
structure-aware selection mode and forward just one paragraph, list, or section.
See [fork.md](fork.md).

## User flow

1. Open a session from the sidebar or project page. A session with no messages
   and no saved draft shows a dedicated New message view instead of the message
   list. Creating a new session opens the composer automatically in the
   last-used size (expanded by default) and binds it to the new session. Opening
   an empty draft with locally saved text opens the composer too; otherwise
   press **New** to reopen it bound to that session.
2. Clara loads the newest messages and opens the thread with the top of the
   newest message at the top of the view, directly below the header and any
   request panel above the thread, so a long reply is readable from its first
   line. A session that is still running keeps following the newest output
   instead. The down-arrow control jumps to the newest output.
3. Click **Reply**, type in the reply window, and press Enter; the prompt appears
   immediately and the header switches to "running". If the composer was already
   open or minimized on another session, it stays connected there instead; close
   it to reply to the session on screen, or use its return button to go back.
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
   with allow once, always allow, and reject. Click the card header to fold it
   while the request stays pending. A collapsed **Agent's thinking** option
   expands to the reasoning that led to the request.
9. Use **Stop** or Escape to interrupt a run; sending another message while the
   agent is working steers the active run, or use the composer's chevron menu to
   send it as queued for the next turn.
10. When the run finishes the header returns to "idle" and usage settles.
11. When a Plan run ends with a final reply, a plan-ready card appears above the
    thread. **Adjust Plan** opens the reply window for changes, re-targeting it
    to this session if it was open on another; **Start Work** switches to the
    working agent and sends a short synthetic handoff, which appears as a
    **User confirmed. Starting work.** system row. Click the card header to fold
    it to its title until you are ready to act.
12. Open a session with a saved draft. The queued user message appears in the
    thread and a Start card appears above it. Click **Start** to send a short
    synthetic approval, deliver the draft, and begin the run; the handoff
    appears as a **User confirmed. Starting saved draft.** system row. Fold the
    card to its title first if you are not ready to act.
13. Answer an agent question. **Submit** sends only the form. Use the chevron
    beside Submit and choose **Add a message** to stage the current answers in
    the composer as a form-response attachment; the form card stays hidden while
    the composer holds it. Send answers every staged form and then sends the
    custom message, sending the answers to the model once through the form
    reply. Closing the composer first restores the form unanswered. The form
    disappears when submitted, and the question-and-answer summary is appended
    to the thread as a **Answered N questions** system row. The event is derived
    from the completed `question` tool, so it survives reloads without another
    request. A question card can be folded to its title while it waits.
14. Click a message header to fold it; a folded message shows its header and the
    first line only. The button in the top-right folds or opens every message.
15. Click the eye button next to it to show or hide internal output. The choice
    is remembered across sessions and reloads.
16. To forward one part of a long reply, choose **Select part** on an expanded
    assistant message. Hover a block to preview it, click to select a paragraph,
    list, code fence, table, quote, or heading section, or Shift-click to extend
    the range. The floating bar shows the section path and length; **Expand**
    moves one level out, **Forward selection** opens the new draft with that
    markdown, and Escape cancels.
17. The header's more menu can **Snooze session** or **Remove from Snoozed**.
    Snoozing moves the session to the sidebar's Snoozed bucket and replaces Done
    with Reopen. Replying, starting work, saving a draft, or answering the agent
    on a snoozed session clears the snooze first and returns it to its mailbox
    section.
18. Open a daemon worker from the Workers section. While Clara management is on,
    the thread streams normally and Stop remains available, but there is no
    composer, Done, Reply, session fork, message fork, compact, snooze, or
    plan-ready card. Messages can still be forwarded, the header can archive or
    delete the worker, an archived worker shows Reopen, and the right-panel Plan
    section can request or refresh its checklist.

## Core business rules

1. The event stream is authoritative during a run; persisted history is loaded on
   open and refetched on idle to reconcile.
2. Streaming text and reasoning are appended to ordered content parts, and tool
   cards are keyed by tool call ID.
3. Permissions block tool execution until the person chooses once, always, or
   reject. Each prompt starts expanded and can be folded to its header while it
   stays pending. Each prompt also offers a collapsed **Agent's thinking**
   disclosure. It uses the request's tool source to show the reasoning that came
   before that tool call in the same assistant step, falls back to the newest
   assistant step when the source is unavailable, and stays hidden when no
   reasoning was recorded. It is available whether or not internal output is on.
4. History loads the newest 100 messages first. Opening a thread positions the
   top of the newest message at the top of the view unless the session is
   running, in which case the view follows new output; scrolling near the top
   fetches older pages with the server's cursor and keeps the view anchored to
   the first visible message. A request panel above the thread (permission,
   question form, plan-ready, or draft start) is in normal document flow, so the
   newest message starts just below it without any extra offset. Each request
   card starts expanded and folds independently to its title; folded content is
   clipped and not focusable. Folding is held in memory for the mounted card and
   resets when the person leaves the session.
5. Unknown event types are ignored so a newer server does not break the view.
6. Each message renders as a full-width row with a `U`/`A` avatar, sender name,
   timestamp, and a divider. A user message with `metadata.synthetic === true`
   uses a Zap avatar and the sender name **Automation** instead of `U` and
   **User**; this attribution is not gated by Clara management. Assistant
   headers show the model name and an agent chip with the bot icon. Token and
   cost details appear in a muted footer under the content. With internal output
   on, every assistant step shows its own footer. With internal output off, the
   next visible reply absorbs the hidden steps before it and shows one combined
   footer: input and output tokens, cost, reasoning characters, tool calls, and
   turns. A turn that ends on hidden work with no reply keeps a compact
   **Thinking** footer carrying the same totals, with its reasoning character
   count beside the label and three animated dots above it while the run is
   live. System events render as compact divider rows with an icon, a label, a
   timestamp, and optional expandable detail; they never look like a prompt the
   person typed. System reminders use the same row, collapsed by default,
   labeled **System Reminder**, and hidden unless internal output is on.
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
    tool calls, shell commands, system reminders, and untagged synthetic, skill,
    and compaction notices. Clara's own system events and question-answer
    summaries stay visible at every detail level. The preference is stored in
    `localStorage` and shared across sessions. A failed turn is never treated as
    internal output: its error stays visible at every detail level.
11. Agent-switched and system messages are never rendered; the agent is shown on
    the assistant header instead. A synthetic message containing
    `<system-reminder>` blocks becomes a collapsed **System Reminder** row when
    internal output is on, with the tags removed from its expandable detail.
    Other untagged synthetic messages stay behind the internal-output toggle.
    Clara's one-click actions write synthetic input with a human-facing
    description, so they appear as system events instead of fake user prompts.
12. Done is available only while the composer is closed, the agent is idle, and
    the session has a message. It archives the session on the server without
    changing its title and returns to the start view. An empty, non-archived
    draft shows a simple **Delete** action instead: it removes the session
    immediately without the celebration, chime, or redirect delay. Empty drafts
    show **New** in place of Reply; New opens the composer in the last-used
    size, binding it to the current session, and opening an empty draft with
    locally saved composer text opens it automatically. The New message view
    itself has no action button. The Done button plays the UI completion chime
    when **UI sounds** is on; its animation and success toast do not depend on
    sound settings. The start view returns after a short celebration delay.
13. Archived or snoozed sessions show Reopen instead of Done next to Reply.
    Reopen clears the server's archived flag and any snooze metadata without
    renaming the session, so the session returns to its mailbox section with its
    title intact. Archived wins when both flags are present. Any reply that
    engages the agent — a prompt, Start, Start Work or a plan request, a command,
    a saved draft, a permission decision, or a question answer — clears the
    snooze marker first, so the session leaves Snoozed without a manual Reopen.
14. The plan-ready card appears only while the session is idle, the session agent
    is Plan, and the newest user or assistant message is a Plan reply that
    finished with `stop` and no error. It is hidden while the composer is open on
    that session and on archived sessions; a composer connected to a different
    session does not hide it. Build switches the agent before sending
    `Confirmed`, and both requests disable the buttons while they are in flight.
    Once `Confirmed` is sent, Build advances the Monitor Inbox like Send does.
    The card starts expanded and can be folded to its title; folding does not
    cancel a start-work request already in flight.
15. The Start card appears only while the session is idle, not archived, and the
    server reports pending user items in the session inbox. Pending inbox user
    messages are merged into the thread by message ID, so a draft is visible
    before it is delivered and disappears cleanly once it becomes a real
    message. Start sends a short synthetic approval with steering, which gives
    the agent context without repeating the draft or adding a fake user prompt;
    the handoff renders as a system row. The button disables while the request
    is in flight. The card starts expanded and can be folded to its title
    without cancelling the start request.
16. A session is a worker when Clara management is on and its metadata says
    `automation === true`. Worker mode suppresses the composer, Done, Reply,
    New, message and session fork, compact, snooze, the plan-ready card, and
    draft views. It keeps Stop, Forward, Reopen for archived workers, Archive,
    Delete, permission and question panels, and the Plan section with its
    Request Plan and Request Update actions. When management is off or the
    feature is excluded from the build, the same session uses the normal chat
    controls.
17. If a message-sending request fails with OpenCode's `LocationNotFoundError`,
    Clara shows a toast that the workspace folder is missing, moves the session
    to the project's canonical directory with `session.move`, and retries the
    same request once. This covers prompts, queued messages, commands, saved
    drafts, Start, Plan requests, and the Start Work handoff including its agent
    switch. The retry keeps the original text, attachments, and delivery.
18. A question form offers **Submit**, which answers only the form, and a chevron
    menu with **Add a message**. The second action stages a copy of the current
    answers in the composer and hides that form card while the composer is open
    or minimized on the same session. The staged answers are display-only; Send
    answers each staged form through `session.form.reply` first, then sends the
    custom prompt or command. Staged answers are never attached as prompt files,
    so the model receives them once. Removing the attachment or closing the
    composer restores the unanswered form. A failed form reply keeps the
    composer text, files, and staged attachments in place for a retry.
19. An expanded, idle assistant reply with text offers **Select part**. The
    inspector groups only the top-level markdown blocks: headings own their
    section, while paragraphs, lists, code fences, tables, quotes, and dividers
    are single blocks. A selected range is sliced from the original markdown
    source rather than the DOM, so formatting is preserved. Forwarding a
    selection creates an empty draft exactly like forwarding a message, but
    carries only the slice and no attachments. Escape cancels selection instead
    of interrupting a run.

## Edge cases

- **Provider failure** — a turn that fails at the provider (auth, quota, rate
  limit) shows its structured error, HTTP status, and a plain-language next step
  instead of a blank reply, even when internal output is off. A toast names the
  failure, and the error stays attached to the assistant message after a reload.
- **Session folder deleted** — the next message send, command, saved draft, or
  synthetic request shows a toast, moves the session back to the project's
  canonical workspace, and retries once. If the canonical directory is also
  missing or the retry fails, an error toast replaces the reset toast and the
  draft stays intact.
- **Stream disconnect** — the sidebar badge turns into a **Retry** control, the
  provider reconnects with backoff, and a successful reconnect refetches the
  queries that missed events would have invalidated.
- **Session missing** — a "Session not found" state offers the project page.
- **Empty draft** — the New message view replaces the message list, **New**
  replaces Reply, and **Delete** replaces Done. The composer opens
  automatically when locally saved text exists.
- **Draft restored** — reopening an empty draft with locally saved text opens
  the composer with that text; after closing, the New button shows a draft dot.
- **Composer open on another session** — the thread stays on the current session
  while the composer title and connection line name the connected session. All
  sends target that session, the return control jumps back, and closing the
  composer resets it to the current session.
- **Explicit compose actions while open elsewhere** — a new session, Forward, and
  Adjust Plan re-target the composer to their session instead of leaving it on
  the previous one.
- **Saved draft** — the draft is a pending inbox item, not a projected message.
  It is rendered in the thread and the Start card appears; Done archives rather
  than deletes because the draft counts as a message.
- **Queued follow-up** — while the agent is running, the composer's chevron menu
  can send the message as queued. It waits as a pending inbox item in the thread
  and starts as the next turn after the active run settles.
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
- **Collapsed request card** — folding a plan, draft, question, or permission
  card leaves only its icon, title, and badge. Hidden fields and actions are
  clipped and not focusable; expanding restores them in place.
- **Folding while an action is pending** — Start Work, Start, Submit, Skip, or a
  permission decision continues in the background. Re-expanding shows the
  current pending state if the card is still present.
- **Staged form response** — **Add a message** opens the composer with the
  current answers as a removable form-response chip and hides the form card.
  Send answers the form first and then sends the custom message. Closing the
  composer, removing the chip, or moving the composer to another session puts
  the unanswered form back in the panel.
- **Staged form reply fails** — the composer stays open with its text, files,
  and form chips intact so the same send can be retried.
- **Prompt fails after a form is answered** — the form remains answered, its
  staged chip is removed, and the composer keeps the text and files for retry.
  Retrying does not answer the form again.
- **Request resolves while folded** — the card disappears when the request is
  completed or withdrawn; the next request mounts expanded.
- **Session switch with folded requests** — every request card returns to
  expanded. The fold state is never stored across sessions or reloads.
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
  contains reasoning or tool calls is hidden. Its usage rolls into the next
  visible reply, which shows the combined tokens, cost, reasoning characters,
  tools, and turns in its footer. If the turn ends with hidden work and no reply,
  a compact **Thinking** footer keeps the total instead. The prompt that started the
  run stays expanded until the agent produces text.
- **Hidden-only turn** — a run that produces no visible reply leaves one
  **Thinking** footer at the end of the turn. Three dots flash above it while the
  run is live, and it stays static once the session is idle, before the next
  prompt.
- **Prompt sent to a running agent** — the new prompt takes over as the expanded
  message; the previous reply collapses unless it was opened by hand.
- **Plan reply without `stop`** — a Plan run that ends on a tool call, an error,
  or a non-stop finish does not show the plan-ready card.
- **Stale plan handoff** — the card requires the session agent and the newest
  reply to be Plan; switching agents or opening an archived session hides it.
- **Start Work request fails** — a failed switch leaves the card in place; if
  the switch succeeds but the handoff cannot be sent, a toast asks the person to
  send a message from the reply box, and Monitor Inbox does not advance.
- **Snooze clear fails** — the reply, draft, or answer still goes through, a
  warning toast says the brief is still snoozed, and the next interaction
  retries the clear.
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
- **Worker session** — the composer, Done, Reply, New, fork, compact, snooze,
  plan-ready card, and draft views are hidden while Clara management is on.
  Stop, Forward, Archive, Delete, Reopen, and the Plan request remain.
- **Worker session with management off** — the automation-session treatment is
  removed, so the session uses the normal composer and actions; synthetic
  messages still show the Automation sender.
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
- **Part selection while streaming** — **Select part** stays hidden until the
  reply settles; a run that starts while selecting ends selection.
- **Part selection across tool calls** — the selection stays inside the text
  part where it started. Forwarding the whole message still carries every text
  part.
- **Escape while selecting** — Escape cancels the selection and does not
  interrupt the run.
- **Folding during selection** — folding the message or switching sessions ends
  selection and leaves the reply untouched.

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
- Missing folder recovery: `src/features/chat/location-recovery.ts` wraps
  `session.prompt`, `session.command`, `session.synthetic`, and
  `session.switchAgent`; `isMissingDirectoryError` recognizes
  `LocationNotFoundError`, and the base directory comes from the canonical
  project record for the session's `projectID`
- Synthetic attribution: `src/features/chat/message-attribution.ts` reads
  `message.metadata.synthetic === true`; the base build always renders the Zap
  avatar and Automation sender through `src/components/chat/message-item.tsx`
- Worker mode: `session.metadata.automation === true` combined with
  `CLARA_FEATURE_INCLUDED` and the relay status management flag; it gates
  `src/pages/chat-page.tsx`, `reply-dock.tsx`, `chat-header.tsx`,
  `message-list.tsx`, and `message-actions.tsx`
- Pending drafts: `client.session.inbox.list({ sessionID })`, merged into the
  thread by message ID
- Start draft: `client.session.synthetic({ sessionID, text, description,
metadata, delivery: 'steer' })`
- Start card: `src/components/chat/draft-start-panel.tsx`
- New message view: `src/components/chat/draft-session-view.tsx`
- Done: `client.session.update({ sessionID, title, archived: true })`; the
  button is `src/components/chat/done-button.tsx` and the chime is
  `playDoneSound` in `src/features/notifications/sounds.ts`
- Snooze: `client.session.update({ sessionID, metadata: { ...existing, snoozed: true } })`
- Reopen: `client.session.update({ sessionID, archived: false, metadata? })` —
  clears archived and snooze metadata; no title change
- Unsnooze on engage: every prompt, command, draft save, permission decision,
  and question answer clears the snooze marker first through
  `unsnoozeSessionOnEngage` in `src/features/sessions/unsnooze.ts`
- Delete empty draft: `client.session.remove({ sessionID })`; the button is
  rendered by `src/components/chat/reply-actions.tsx`
- Interrupt: `client.session.interrupt({ sessionID })`
- Approvals: `client.permission.request.list`, `client.permission.reply`;
  request thinking comes from `src/features/chat/permission-thinking.ts`
- Forms: `client.session.form.list`, `client.session.form.reply`; staged form
  responses live in `src/features/chat/composer-provider.tsx` and are displayed
  through `src/components/chat/form-response-attachment.tsx`
- Request cards: `src/components/chat/request-card.tsx` renders the header
  toggle, per-card expanded state, and top-anchored reveal shared by the
  plan-ready, draft-start, question, and permission cards
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
- Reply event: `clara:open-reply` opens the reply window when it is closed,
  restores a minimized window, and focuses an open one
- Composer connection: `src/features/chat/composer-provider.tsx`,
  `src/features/chat/composer-session.ts`, and
  `src/features/chat/use-composer-target.ts` keep the open or minimized window
  connected to its session across route changes
- Pair terminal: `src/features/chat/terminal-log.ts`,
  `src/components/chat/pair-terminal.tsx`, and the `session.tool.progress`
  event. See [pair terminal](pair-terminal.md).
- Part selection: `src/features/chat/markdown-blocks.ts` builds sections and
  slices the source; `src/components/chat/markdown-selection.tsx` owns the
  inspector and floating bar; `src/components/chat/markdown.tsx` writes the
  block offsets from react-markdown's `node.position`
- Store: `src/features/chat/chat-store.ts`
- Collapse state: `src/hooks/use-collapsed-messages.ts`
- Internal-output visibility: `src/features/chat/message-visibility.ts`
- Hidden-step usage: `src/features/chat/usage-summary.ts` sums reasoning
  characters, tokens, cost, tools, and turns; `src/features/chat/timeline.ts`
  rolls those totals into the next visible reply and emits a
  `hidden-activity` row when none follows. The row lives in
  `src/components/chat/hidden-activity-row.tsx`.
- Internal-output preference: `clara.internalMessages` in `localStorage`
- Local composer draft: `clara.draft.<sessionID>` in `localStorage`
- Related: [capabilities](capabilities.md), [composer](composer.md)

</details>
