---
title: Session lifecycle
description: Create, close, snooze, reopen, and delete sessions.
sidebar_position: 2
---

# Session lifecycle

## Summary

A session moves through the browser from a new draft to running work and then to
a closed state. This page covers the actions that move it: New session and its
workspace choice, empty-draft cleanup, Done, snooze, archive, reopen, and delete,
including shift-click range selection and bulk deletion. The mailbox sections
themselves are defined in [index.md](index.md).

## User flow

1. **New session** creates a session in the selected project. With several
   workspaces the button opens a menu; otherwise it uses the workspace the
   project last used.
2. The new empty session appears in Drafts with its composer focused, ready for
   a first prompt.
3. Sending the first prompt moves the session to Outbox as soon as the harness
   accepts it.
4. **Done** in the composer's send menu archives the session without renaming it
   and returns to the start view, or opens the next Inbox session while Monitor
   Inbox is active. An empty draft offers **Delete empty draft** instead.
5. Snooze in the chat header postpones a session until it is reopened or engaged.
   An archived or snoozed session offers **Reopen** in the send menu.
6. A normal click selects and opens a session. Shift-click or Shift+Enter extends
   the selection from the anchor.
7. Delete or Backspace opens a confirmation for the selected range; confirming
   removes the sessions permanently.
8. Leaving an untitled draft with nothing in it discards the empty session.

## Core business rules

1. New session picks a workspace in this order: the workspace last used for this
   project, the project's default workspace when online, the first online
   workspace, then the first linked workspace. The last-used workspace wins even
   when its harness is offline, so work never silently moves to another machine.
   A workspace can start work only when it is linked and its harness is online.
2. A new session inherits the model of the most recent active session in the same
   workspace and harness. A workspace without one starts on the harness default,
   and a model hidden in Settings → Models is never inherited. Its agent follows
   the **Default agent** setting; a specific agent also replaces the agent of an
   empty draft the first time that draft is opened.
3. Leaving an untitled session with no user or assistant message, no composer
   text or attachments, no saved draft, and no waiting request removes it. Titled,
   running, worker, archived, and snoozed sessions are kept, and selection or an
   idle note does not count as content. Old untitled empty sessions are swept from
   the list when the chat view is closed.
4. **Done** sets the archived flag without changing the title and is hidden while
   the agent runs and on snoozed sessions. **Delete empty draft** removes a
   non-archived draft immediately. Archive state comes only from the server's
   `archived` timestamp, and snooze state only from `metadata.snoozed`.
5. Snoozed sessions leave Inbox, Outbox, and Drafts. Sending a reply, starting
   work, requesting a plan, running a command, saving a draft, or answering a
   permission or question clears the snooze marker first. Snoozed sessions do not
   trigger desktop notifications, inbox sounds, or Monitor Inbox.
6. **Reopen** clears the archived flag and any snooze metadata and leaves the
   title untouched. It is available while the composer is idle and the session is
   archived or snoozed; the chat header's more menu offers it on an archived
   session regardless of run state.
7. A normal click opens a session and makes its row the anchor. Shift-click or
   Shift+Enter selects the inclusive rendered range from the anchor in section
   order (Inbox, Outbox, Drafts, Snoozed, Archived); collapsed sections contribute
   no rows. Clear, a project change, and a search change clear the selection, and
   a successful refresh prunes IDs that disappeared.
8. Delete or Backspace on a non-empty selection opens a confirmation unless focus
   is in a text-entry target or another Clara dialog, menu, popover, select, or
   sheet is open. Confirming runs one `session.remove` per session, four at a
   time. Partial failure keeps failed rows selected and names them; success
   focuses a surviving row. Deleting the open session returns to its project page.
9. The mobile drawer keeps its own selection and clears it when it closes. Clear
   and Delete keep 44px touch targets there.

## Edge cases

- **Last-used workspace is offline** — New session stays pointed at it and is
  disabled until the harness reconnects; other workspaces appear disabled in the
  menu.
- **Every workspace is offline** — New session is disabled and the view names the
  offline harness, pointing at the workspace menu.
- **Two workspaces share a harness label** — the menu appends a short harness id
  so the rows stay distinguishable.
- **Session creation fails** — the button returns to normal and no navigation
  happens.
- **Done or composer Reopen while running** — both are hidden until the run
  finishes; the header's more menu still offers Reopen on an archived session.
- **Snoozing while running** — the run continues but the session stays out of
  Outbox and alerts; Reopen stays hidden until it finishes.
- **Partial bulk delete failure** — successful sessions disappear, failed rows
  stay selected with their titles in the toast, and retrying acts only on what
  remains.
- **Open session deleted in a batch** — Clara shows the result and routes to the
  project page; if that session failed, the chat stays open.
- **Shift-click with no anchor** — the clicked row becomes the anchor and the only
  selected row.
- **Delete or Backspace in search, the composer, or contenteditable text** — the
  shortcut is ignored, as it is for Ctrl, Meta, Alt, key repeat, IME composition,
  an open dialog or menu, or a deletion already running.

## Out of scope

- Bulk actions other than the sidebar's range deletion
- Moving sessions between projects, or between harnesses
- Creating, switching, or removing worktrees
- Organizing sessions into folders or tags

## Known gaps

- Saved drafts cannot be edited or cancelled from Clara yet; start the draft or
  delete the session.
- The 50-session list cap hides older sessions except through search.

## Technical appendix

<details>
<summary>Routes, data, and references</summary>

- Create: `client.session.create({ location: { directory }, harnessID, agent, model })`;
  `agent` resolves from `clara.defaultAgent` and `clara.lastAgent`.
- Workspace choice: `resolveProjectWorkspaceTarget` and
  `workspaceHarnessLabels` in `src/features/projects/project-workspaces.ts`;
  the last workspace is `clara:last-workspace:<projectID>` in local storage.
- Empty-draft discard: `useDiscardEmptyDraft` waits, rechecks the composer,
  `clara.draft.<sessionID>`, the latest user and assistant messages, and the
  session inbox, then removes the session and closes its tab.
- Sweep: `usePruneEmptyDrafts` runs from the sidebar outside the chat view with
  a 60-second grace period.
- Done: `client.session.update({ sessionID, archived: true })`; Reopen clears
  `archived` and any snooze metadata.
- Snooze: `client.session.update` with merged `metadata.snoozed`; unsnooze goes
  through `src/features/sessions/unsnooze.ts`.
- Selection: `selectRange` and `pruneSelection` in
  `src/features/sessions/session-selection.ts`.
- Delete: `useDeleteSessions` runs four writes at a time through
  `runWithConcurrencySettled`.
- Composer tabs: `clara.composerTabs` in local storage.
- Routes: see the [routing table](../../architecture/overview.md#routing) and
  [chat](../chat/index.md) for the view that opens a session.

</details>
