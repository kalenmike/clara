# Chat

## Summary

The chat view is where people read and steer a harness session. It shows the
conversation as an email-style thread, streams new output as it arrives, exposes
tool activity behind an internal-output toggle, and pauses for approval when the
agent needs permission. Prompt and reply text renders as GitHub-flavored
Markdown, with single line breaks preserved in prompts; the composer stays plain
text. Each message is a full-width, left-aligned row with a small avatar, the
sender name, and a timestamp above the content, separated by a divider.

## Read when

| Document                     | Read when…                                                                      |
| ---------------------------- | ------------------------------------------------------------------------------- |
| [approvals.md](approvals.md) | You are working on permission prompts, thinking, questions, or the plan handoff |
| [composer.md](composer.md)   | You are working on the prompt box, its tabs, attachments, or send menu          |
| [fork.md](fork.md)           | You are working on forking a session or forwarding a message                    |

## User flow

1. Open a session from the sidebar or project page. The header names the
   session, shows whether it is busy or idle, names the active agent, and names
   the harness that owns the session. A session with no messages and no saved
   draft shows a dedicated New message view instead of the message list.
2. Clara loads the newest messages and opens the thread at its newest output,
   directly below the header, its usage bar, and any request panel above the
   thread, without visible scroll. The view then stays where the person leaves
   it; only new output follows while they are at the end.
3. Type in the composer below the thread and press Enter. The prompt appears
   immediately and the header switches to busy.
4. Assistant text streams in. Turn on internal output in the header to see
   reasoning, tool calls, shell commands, and untagged system notices. Open the
   **Terminal** tab in the right panel to watch commands separately.
5. Tool calls appear as cards that expand to show input, output, duration, and
   status when internal output is on.
6. Use **Stop** or Escape to interrupt a run. Sending another message while the
   agent works steers the active run, or the composer's chevron menu sends it as
   queued for the next turn.
7. Click a message header to fold it; the button in the top-right folds or opens
   every message. The eye button beside it shows or hides internal output.
8. When the run is idle, read the usage bar below the header and choose **Done**
   or **Reopen** from the send menu. Prompts and questions pause the thread until
   answered; see [approvals.md](approvals.md).

## Core business rules

1. The event stream is authoritative while a run is active; persisted history is
   loaded on open and refetched on idle to reconcile. Unknown event types are
   ignored so a newer server cannot break the view. The frame-by-frame model is
   described in [the streaming model](../../architecture/overview.md#streaming-model).
2. History loads the newest 100 messages first, and scrolling near the top
   fetches older pages with the server's cursor while keeping the first visible
   message anchored in place. A request panel above the thread sits in normal
   document flow, so the newest message starts just below it without an offset.
   The left-edge arrows step by message and skip system-event and hidden-activity
   rows.
3. Each message renders as one row with a `U`/`A` avatar, sender name, timestamp,
   and divider. A user message with `metadata.synthetic === true` uses a Zap
   avatar and the sender name **Automation** instead of `U` and **User**; this
   attribution is not gated by orchestration. Assistant headers show the model
   name and an agent chip.
4. The newest prompt or reply starts expanded and every earlier reply starts
   collapsed. An assistant step does not count as a reply until it has text or
   fails, so the prompt that started a run stays expanded while the agent thinks.
   A collapsed message shows its header and one line: the prompt's first line,
   the first assistant text, or the shell command. Collapse state lives in memory
   for the open session. The header's fold-all button collapses every message
   unless they are already all collapsed, and only that fully collapsed state
   expands them again; the icon reflects the next action.
5. Internal output is hidden by default. The header toggle covers reasoning, tool
   calls, shell commands, collapsed **System Reminder** rows whose detail drops
   the reminder tags, and untagged synthetic, skill, and compaction notices; the
   preference persists in `localStorage`. Clara's own system events,
   question-answer summaries, and location switches stay visible at every detail
   level; a location row names the new folder with a start-elided path.
   Agent-switched and system messages are never rendered, and a failed turn stays
   visible because an error is never treated as internal output.
6. Token and cost details sit in a muted footer under the content, following the
   **Cost display** setting. With internal output off, the next visible reply
   absorbs hidden steps and shows one combined footer; a turn that ends on hidden
   work keeps one compact **Thinking** footer, even when system rows split the
   steps. The usage bar below the header shows whole-session totals from the
   server rather than loaded pages. See [session panel](../session-panel.md).

## Edge cases

- **Provider failure** — a turn that fails at the provider shows its structured
  error, HTTP status, and a plain-language next step instead of a blank reply,
  even when internal output is off. The error stays attached after a reload.
- **Stream disconnect** — the sidebar badge turns into a **Retry** control, the
  provider reconnects with backoff, and a successful reconnect refetches the
  queries that missed events would have invalidated.
- **Session missing** — a "Session not found" state offers the project page.
- **Empty draft** — the New message view replaces the message list; the composer
  stays open and the send menu offers **Delete empty draft**.
- **Running session opened mid-run** — the header seeds `busy` from the active
  session map, then returns to idle when the run ends or the next fetch disagrees.
- **Very long conversation** — older pages load as the list approaches the top,
  and the first visible message stays in place while pages are prepended.
- **History changed** — compaction or a revert clears cached older pages and
  reloads the newest page from the server.
- **No preview text** — a collapsed message falls back to the first tool name, an
  attachment count, or just its header.
- **Streaming while collapsed** — a message folded by hand stays folded as text
  streams in; the header button opens it again.
- **Narrow viewport** — the title keeps its own row and ellipsizes, and the
  header actions move below the usage bar with 44px touch targets.

## Out of scope

- Diff review, revert, or snapshot browsing
- Todos, worktrees, interactive PTY sessions, or MCP management
- Editing or deleting individual messages
- Message search inside a session

## Known gaps

- `idle` system messages are hidden to reduce noise; double-press navigation
  gestures are pointer-only, so keyboard activation performs a single step.

## Technical appendix

<details>
<summary>Routes, data, and references</summary>

- Route: `/p/:projectId/s/:sessionId`; start view `/`
- History: `client.message.list({ sessionID, order: 'desc', limit: 100 })` for
  the newest page, reversed for display; older pages use the cursor form and are
  merged by ID into `chatStore`
- Stream: `client.event.subscribe()` through `EventProvider`
- Send: `client.session.prompt({ sessionID, text, files, delivery })`
- Store: `src/features/chat/chat-store.ts`; timeline rows come from
  `src/features/chat/timeline.ts`
- Message rows: `src/components/chat/message-item.tsx`; list, scroll anchoring,
  and the step arrows live in `message-list.tsx` and
  `src/features/chat/message-navigation.ts`
- Collapse: `src/hooks/use-collapsed-messages.ts`; the all-messages button is in
  `src/components/chat/chat-header.tsx`
- Internal output: `src/features/chat/message-visibility.ts`,
  `src/features/chat/usage-summary.ts`, and `hidden-activity-row.tsx`
- Usage bar: `src/components/chat/session-stats-bar.tsx` and
  `src/features/chat/session-usage.ts`; totals come from
  `snapshot.tokens ?? session.tokens`
- System events: `src/features/chat/system-events.ts`,
  `src/features/chat/questions.ts`, and `system-event-row.tsx`
- Run state: `src/features/chat/use-session-status.ts`

</details>
