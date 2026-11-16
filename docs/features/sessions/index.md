---
title: Sessions
description: Find work in the project switcher and the five mailbox sections.
sidebar_position: 1
---

# Sessions

## Summary

The project and session browser is how people find their work. The sidebar
switcher moves between recent projects, and the session list sorts every session
into five mailbox sections so waiting work, running work, drafts, and closed work
stay apart. Search and collapse controls keep long lists usable, Monitor Inbox
walks a person through what needs them, and the interface calls a session a
**Brief** by default.

## Read when

| Page                         | Read when…                                                           |
| ---------------------------- | -------------------------------------------------------------------- |
| [lifecycle.md](lifecycle.md) | You are creating, closing, snoozing, reopening, or deleting sessions |
| [projects.md](projects.md)   | You are working on projects, workspaces, or project settings         |
| [activity.md](activity.md)   | You are working on the cross-workspace Inbox and Outbox view         |

## User flow

1. After connecting, Clara opens the start view with the last project selected,
   or the first project when none has been used.
2. The sidebar project button opens the seven most recently active projects,
   skipping empty ones, plus the current project when it falls outside that
   window. **New project** and **All projects** end the menu.
3. Choosing a project loads its sessions into Inbox, Outbox, Drafts, Snoozed,
   and Archived. Each section header shows its count whether expanded or
   collapsed.
4. The person reads Inbox for work that needs them, Outbox for work an agent
   still owes, Drafts for sessions with nothing sent, Snoozed for postponed
   sessions, and Archived for closed ones.
5. The search box filters by title and temporarily opens every section. A toggle
   beside it opens or closes all sections at once.
6. **New session** creates a draft and opens its composer. With more than one
   workspace the button first asks which one to use.
7. Opening a session loads the chat, or the New message view when there is no
   message and no pending draft. The session's composer tab becomes active.
8. **Monitor Inbox** on the start view jumps to the newest Inbox session and
   advances as each one is handled.

## Core business rules

1. **Inbox** holds sessions that need the person: a pending approval or
   question, or an idle session whose latest conversational message is from the
   agent. **Outbox** holds sessions where the agent still owes a reply,
   including every running session. A session awaiting input moves to Inbox
   while its run is still active and returns to Outbox after the reply.
2. Inbox and Outbox read the latest `user` or `assistant` message together with
   live run state. Once a session is idle, the latest message author decides;
   internal messages such as `idle`, `system`, and model switches are ignored. A
   follow-up queued while a run is active is a pending Inbox item. Unread Inbox
   sessions use a heavier title weight and a blue dot until opened.
3. **Drafts** holds sessions with no projected user or assistant message that are
   not running, including sessions whose first message was saved with the
   harness's no-reply mode. A saved draft is shown in the chat and can be
   started from the Start panel.
4. **Snoozed** holds sessions postponed with `metadata.snoozed`, and **Archived**
   holds sessions with a server `archived` timestamp. Archived wins when both
   apply. Title text, including a legacy `[DONE]` suffix, never moves a session
   between sections on its own.
5. Search asks the server for matching titles and forces every section open
   without overwriting saved collapse state. The toggle beside it opens or
   closes all sections. Section counts remain visible either way.
6. Monitor Inbox targets the newest Inbox session by update time, independent of
   the sidebar search. It jumps when turned on, after Done, Send, Build, or
   saving a draft, and when a session newly enters the Inbox while the start view
   is open. Sessions already in the Inbox when the view opens never redirect, and
   manual navigation is never redirected. The switch is remembered on the device
   and shows the project's Outbox count as "N agents working".
7. The interface calls a session a **Brief** by default. Settings → Session
   wording replaces that noun in every label, placeholder, toast, and
   notification, with Brief, Task, Session, Action, Run, and Job presets or a
   custom singular word. The harness API and Clara's internal code still use
   `session`.
8. Running sessions carry a live dot in the list and in their composer tab, so
   another open session's run state is visible without opening it. Inbox rows
   also show what they need: a red pulsing dot for a blocked run, a red dot for a
   failed latest run, an orange dot for a finished Plan awaiting Steer or Build,
   and a grey dot for an idle session to review.

## Edge cases

- **No projects** — the start view offers **New project**; a project can exist
  before any workspace.
- **No sessions** — the list invites the person to create one.
- **Search with no matches** — the list says so without clearing the query.
- **Search active** — every section is temporarily expanded; clearing the search
  restores the saved collapse state.
- **No Inbox sessions while monitoring** — the start view stays with the switch
  on, so monitoring can be turned off, and the next arrival opens automatically.
- **Manual navigation while monitoring** — opening a session outside the Inbox,
  starting a new session, or opening Settings stays put.
- **Inbox still loading on activation** — Clara waits for sessions and mailbox
  signals, then jumps once; navigating first cancels the jump.
- **Inbox request fails** — the current view stays and the switch keeps its saved
  state.
- **Refresh fails** — the last list stays visible with a compact notice; the full
  retry state appears only when nothing is cached.
- **Custom wording is blank** — Clara keeps the current or default noun instead
  of saving an empty label.

## Out of scope

- Organizing sessions into folders or tags
- Sharing, export, or import
- Historical activity, usage charts, or per-file timelines
- Grouping or hiding orchestration worker sessions in this client

## Known gaps

- The active and archived lists each cap at 50 sessions; the cap is not
  discoverable, so older sessions are reached through search.

## Technical appendix

<details>
<summary>Routes, data, and references</summary>

- Routes: see the [routing table](../../architecture/overview.md#routing).
- List: `client.session.list({ project, search, archived, limit })`; the active
  list requests the newest 50 and the archived list reads 20 at a time with a
  cursor and **Load more**.
- Mailbox signals load in one batched request per screen: each session's latest
  `user` and `assistant` message plus pending forms, sent with `time.updated`
  and fanned out by the hub.
- Section state: `clara.sidebarSections` in local storage; monitor preference
  `clara.monitorInbox`; session wording `clara.sessionWording`.
- Inbox monitor: `src/features/sessions/inbox-monitor.tsx` and
  `use-inbox-sessions.ts`.
- Unread: `isSessionUnread` compares `time.idle` with `time.viewed`;
  `useMarkSessionViewed` reports the newest `time.idle` watermark through
  `client.session.view` while the chat is visible.
- Related: [lifecycle](lifecycle.md), [projects](projects.md),
  [activity](activity.md), [chat](../chat/index.md).

</details>
