# Fork and forward

## Summary

Forking branches a session without disturbing the original. Clara can fork the
whole conversation, fork from a specific message, or forward one message into a
new draft with the composer tab prefilled. A long reply can also be forwarded one
section at a time: **Select part** turns the rendered markdown into pickable
blocks, and **Forward selection** sends only that slice into a new draft. The
source session keeps running in its current direction in every case.

## User flow

1. Open a session and choose **Fork brief** from the header's more menu. Clara
   creates a child session with the full settled transcript, opens it, and leaves
   the source running.
2. To branch earlier, hover a user or assistant message and choose **Fork from
   here** from its action rail. The new session contains that message and
   everything above it. On a phone, the same two actions live in the message's
   overflow menu.
3. To start a new conversation from one message, choose **Forward to new brief**.
   Clara creates an empty draft in the same project, switches to it, and selects
   its composer tab with the message text and attachments already filled in.
4. To carry only part of a long reply, choose **Select part** on that message.
   Hovering a block outlines the paragraph, list, code fence, table, quote, or
   heading section that a click would take. Click a heading for its whole
   section, click a block for just that block, or Shift-click another block to
   extend the range.
5. The floating bar shows the section path and length. **Expand** walks up one
   level, from a block to its subsection, its section, and then the whole part of
   the reply. **Forward selection** creates the draft; **Cancel** or Escape
   leaves the reply untouched.
6. Edit the forwarded text or attachments, then send it like any other prompt.
   The source session is unchanged throughout.
7. Click the fork's title to rename it; the server titles forks
   `Parent title (fork #1)`, `(fork #2)`, and so on. Returning to the source
   from the sidebar keeps its stream, status, and unread state.

## Core business rules

1. Forking is copy-only. Clara never interrupts, archives, reverts, or edits the
   source session, and the source's own run, unread state, and stream survive
   untouched.
2. A whole-session fork copies the full settled transcript. A message fork uses
   the next message as the server's exclusive boundary, which copies the selected
   message and everything older; when the selected message is newest, Clara omits
   the boundary and copies the full transcript.
3. Only messages that exist in the server transcript can be fork points. Forks
   copy settled history only: an in-flight assistant reply, a running command or
   compaction, pending drafts, and local composer text do not travel into the
   child.
4. A fork inherits the parent's agent, model, metadata, and title prefix. Clara
   clears the inherited snooze marker so the branch appears in the mailbox
   immediately, and the fork starts with an empty Plan section: the copied
   `todowrite` history stays in the transcript but only a checklist written in
   the branch is shown.
5. Forward does not write a message to the server. Clara creates an empty
   standalone session, not a child, saves the forwarded text as the local
   composer draft, and passes attachments through the navigation state. It
   inherits the source agent and model, and its draft title comes from the
   forwarded text or the first attachment name.
6. Section selection is structure-aware. A heading owns everything until the next
   heading of the same or a higher level, a block click takes only that
   paragraph, list, code fence, table, quote, or divider, and Shift-click unions
   the range with another block. The slice is taken from the original markdown
   source, so formatting survives. Selection is available only on an expanded
   assistant text part that is not streaming, and it forwards text only:
   reasoning, tool calls, and user attachments never travel with it.

## Edge cases

- **Source is running** — the fork copies the last settled messages and may end
  with the prompt that started the current run, without its reply.
- **Selected message is streaming** — fork and forward are disabled until the
  reply finishes.
- **Selected message is newest** — a full-history fork is also the inclusive copy
  of that message; when it is the first message, the child contains just it.
- **Snoozed or archived parent** — the fork's snooze marker is cleared and the
  child is created as a normal, unarchived session.
- **Parent with a plan** — the copy keeps the parent's `todowrite` call in its
  history, but the Plan section hides it until the branch writes its own
  checklist.
- **Forwarded assistant reply** — only text parts are carried over and the text
  becomes an editable user prompt; an assistant reply with no text disables
  Forward while Fork still works.
- **Heading selection** — a heading with no body forwards just the heading line,
  and skipped heading levels still nest, so a `###` after a `#` belongs to that
  `#` and a later `##` closes it.
- **Reply split by tool calls** — a selection stays in the text part where it
  started; forwarding the whole message still carries every text part.
- **Fork, forward, or selection fails** — a toast explains the failure and the
  source stays open and untouched.

## Out of scope

- Session export and import
- A fork tree or visual branch history
- Forking from shell, tool, synthetic, or system rows
- Forwarding to a different project

## Known gaps

- The client exposes only the exclusive `before` boundary, so an inclusive fork
  comes from the next message's ID and relies on snapshot order.
- Forwarded text is stored as a local composer draft until sent; reloading keeps
  the text but not attachments.
- A forwarded assistant reply is presented as user input, because the harness has
  no stable API for injecting an assistant message into a new session.

## Technical appendix

<details>
<summary>Routes, data, and references</summary>

- Whole-session fork: `client.session.fork({ sessionID })`
- Message fork: `client.session.fork({ sessionID, before: nextMessageID })`
- Forward: `client.session.create({ title, agent, model, location })`, then
  `saveDraft(newSessionID, text)` and navigation with
  `{ compose: true, draftText, draftFiles }`
- Selection: `src/features/chat/markdown-blocks.ts` builds heading sections and
  slices the source; `src/components/chat/markdown-selection.tsx` owns hover,
  click, Expand, Escape, and the floating bar
- Fork titles come from the server; `forwardTitleFromText` in
  `src/features/sessions/forward.ts` derives forwarded titles
- Plan filtering: `session-plan.ts` hides pre-fork `todowrite` calls
- Mutations: `use-fork-session.ts` and `use-forward-message.ts`; actions in
  `chat-header.tsx` and `message-actions.tsx`
- Related: [chat](index.md), [sessions](../sessions/index.md)

</details>
