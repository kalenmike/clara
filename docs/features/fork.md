# Fork and forward

## Summary

Forking branches a session without disturbing the original. Clara supports
forking the whole conversation, forking from a specific message, and forwarding
one message into a new draft with the reply window prefilled. The source session
keeps running in its current direction in every case.

## User flow

1. Open a session and choose **Fork brief** from the header's more menu. Clara
   creates a child session with the full settled transcript, opens it, and
   leaves the source running.
2. To branch earlier, hover a user or assistant message and choose **Fork from
   here**. The new session contains that message and everything above it.
3. On a phone, open the message's overflow menu to reach the same two actions.
4. To start a new conversation from one message, choose **Forward to new
   brief**. Clara creates an empty draft in the same project, switches to it,
   and opens the reply window with the message text and attachments already
   filled in.
5. Edit the forwarded text or attachments, then send it like any other prompt.
   The source session is unchanged throughout.
6. Click the fork's title to rename it. The server titles forks `Parent title
(fork #1)`, `(fork #2)`, and so on.
7. Return to the source from the sidebar; it keeps its stream, status, and
   unread state while the fork is open.

## Core business rules

1. Forking is copy-only. Clara never interrupts, archives, reverts, or edits the
   source session.
2. A whole-session fork copies the full settled transcript. A message fork uses
   the next message as the server's exclusive boundary, which copies the
   selected message and everything older. When the selected message is newest,
   Clara omits the boundary and copies the full transcript.
3. Only messages that exist in the server transcript can be fork points.
   Pending inbox drafts and the currently streaming assistant reply are not
   actionable.
4. Forks copy settled history only. An in-flight assistant reply, a running
   shell command, a running compaction, pending drafts, and local composer text
   do not travel into the child.
5. A fork inherits the parent's agent, model, metadata, and title prefix. Clara
   clears the inherited snooze marker so the branch appears in the mailbox
   immediately. It also starts with an empty Plan section: the copied
   `todowrite` history stays in the transcript, but Clara only shows a checklist
   written in the branch.
6. Forward does not write a message to the server. Clara creates an empty draft,
   saves the forwarded text as the local composer draft, and passes attachments
   through the navigation state. The user can edit everything before sending.
7. Forward creates a standalone session, not a child. It inherits the source
   agent and model, and its draft title comes from the forwarded text or the
   first attachment name.

## Edge cases

- **Source is running** — the fork copies the last settled messages. The child
  may end with the prompt that started the current run, without its reply.
- **Selected message is streaming** — fork and forward are disabled until the
  reply finishes.
- **Selected message is newest** — a full-history fork is also the inclusive
  copy of that message.
- **Selected message is first** — the child contains just that message.
- **Pending draft selected** — it is not a server message, so no actions appear.
- **Snoozed parent** — the fork's inherited snooze marker is cleared.
- **Archived parent** — the fork is created as a normal, unarchived session.
- **Parent with a plan** — the copy keeps the parent's `todowrite` call in its
  history, but the Plan section hides it until the branch writes its own
  checklist.
- **Forwarded assistant reply** — only text parts are carried over; reasoning and
  tool calls are skipped. The text becomes an editable user prompt.
- **Assistant reply with no text** — Forward is disabled; Fork still works.
- **User message with only attachments** — attachments are prefilled and the
  title falls back to the first attachment name.
- **Fork or forward fails** — a toast explains the failure and the source stays
  open and untouched.
- **Attachments in a forwarded draft** — they live in the reply window until the
  message is sent; closing the window before sending drops them, as with any
  composer attachment.

## Out of scope

- Session export and import
- A fork tree or visual branch history
- Forking from shell, tool, synthetic, or system rows
- Forwarding to a different project
- Automatic sibling numbering beyond the server's `(fork #n)` title
- Diff review, revert, or snapshot browsing

## Known gaps

- The client exposes only the server's exclusive `before` boundary, so Clara
  computes an inclusive message fork from the next message's ID. Same-millisecond
  message ordering therefore relies on the order the transcript snapshot holds.
- Forwarded text is stored as a local composer draft until sent. Reloading keeps
  the text, but not attachments.
- A forwarded assistant reply is presented as user input, because OpenCode has
  no stable API for injecting an assistant message into a new session.

## Technical appendix

<details>
<summary>Routes, data, and references</summary>

- Whole-session fork: `client.session.fork({ sessionID })`
- Message fork: `client.session.fork({ sessionID, before: nextMessageID })`
- Forward: `client.session.create({ title, agent, model, location })`, then
  `saveDraft(newSessionID, text)` and navigation with
  `{ compose: true, draftText, draftFiles }`
- Fork titles come from the server: `Parent title (fork #n)`
- Fork events: `session.forked` invalidates sessions and the child transcript
- Plan filtering: `src/features/chat/session-plan.ts` hides `todowrite` calls
  created before the fork's `session.time.created`
- Helpers: `src/features/sessions/fork.ts` and
  `src/features/sessions/forward.ts`
- Mutations: `src/features/sessions/use-fork-session.ts` and
  `src/features/sessions/use-forward-message.ts`
- Header action: `src/components/chat/chat-header.tsx`
- Message actions: `src/components/chat/message-actions.tsx`
- Composer prefill: `src/components/chat/composer.tsx`,
  `src/components/chat/reply-dock.tsx`, and `ChatComposeState`
- Related: [chat.md](chat.md), [sessions.md](sessions.md),
  [capabilities.md](capabilities.md)

</details>
