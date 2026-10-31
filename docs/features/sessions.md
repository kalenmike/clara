# Sessions

## Summary

The project and session browser is how people find their work. Projects group
sessions by the directory OpenCode opened; sessions are the units of conversation
that Clara opens in the chat view.

## User flow

1. After connecting, Clara shows the **Start a new session** view with the last
   project or the first project selected in the sidebar.
2. The sidebar project button opens a menu of every project the server knows,
   showing its name and canonical path.
3. Choosing a project loads its sessions into four collapsible sections: Inbox,
   Outbox, Drafts, and Archived.
4. Inbox holds sessions that need the person: a pending approval or question,
   or an idle session whose latest conversational message is from the agent.
   Outbox holds sessions where the agent still owes a reply, including every
   running session.
5. Drafts holds empty sessions and sessions with a saved no-reply draft that
   has not produced a projected message yet. Archived holds sessions archived on
   the server.
6. The search box filters sessions by title using the server's search parameter
   and temporarily expands every section so matching titles are visible.
7. **New session** creates a session in the selected project and opens the reply
   composer in the last-used size (expanded by default), ready for the first
   prompt; the empty session appears in Drafts.
8. On the project page, sessions also appear as cards with agent, model, token
   totals, cost, and update time.
9. Opening a session shows it in the sidebar and loads the chat view, or the
   empty session view when it has no messages and no pending draft.
10. A floating **Inbox** button at the bottom center of the chat opens the newest
    Inbox session. It is greyed out when the Inbox is empty or the open session
    is already the newest Inbox session.
11. The chat header can rename, archive, or delete the current session.
12. The Done button in the reply dock appends `[DONE]` to the title, archives
    the session, briefly celebrates, and returns to the start view. On a session
    with no messages, Done deletes the session instead of archiving it.
13. Opening an archived session shows a Reopen button next to Reply. Reopening
    clears the server's archived flag and leaves the title untouched, so a
    `[DONE]` suffix stays in place until the person renames the session.

## Core business rules

1. Sessions are fetched by the project's **directory**, not by project ID; the
   server's `project` filter does not return the expected rows in 2.1.1.
2. The active list shows the newest 50 non-archived sessions for the directory;
   the archived list shows the newest 50 archived sessions.
3. A new session inherits the agent and model of the most recent active session
   in the project, so the first prompt uses a model that already works.
4. Running sessions are marked with a live dot driven by the active-session map
   and status events, and that same map keeps them in Outbox. Inbox rows show
   what they need: a red pulsing dot while a run is blocked on an approval or
   question, a red dot when the latest message is a failed run, an orange dot
   when a finished Plan reply is waiting for Steer or Build, and a grey dot for
   an idle session to review and close. The error dot is reserved for failed
   last messages; it does not apply to older errors already followed by a reply.
   These states also drive Inbox alerts; see
   [notifications](notifications.md).
5. Inbox, Outbox, and Drafts combine the latest `user` or `assistant` message
   with live run state. A pending permission or form request puts the session in
   Inbox; a running session stays in Outbox even after the agent writes; once
   idle, the latest message author decides (agent → Inbox, user → Outbox).
   Internal messages such as `idle`, `system`, and model switches are ignored.
6. Drafts contains sessions with no projected user or assistant messages that
   are not running. This includes new empty sessions and sessions whose first
   message was saved with OpenCode's no-reply mode and still sits in the session
   inbox. The queued message is shown in the chat and can be started from the
   Start panel.
7. Archive state comes only from the server's `archived` timestamp. A `[DONE]`
   or `(DONE)` title never moves a session out of Inbox on its own.
8. Done appends `[DONE]` unless the title already has a completion suffix, sets
   the server's archived flag, and returns to the start view after a short
   celebration delay. On an empty session it deletes the session instead. It is
   hidden while the agent is running.
9. Reopening clears the archived flag and does not rename the session. Reopen is
   available only while the reply window is closed and the agent is idle.
10. A session without projected messages and without a pending draft shows the
    empty session view instead of the chat, with a single action that opens the
    reply window in the last-used size. A new session skips this step and opens
    the composer immediately.
11. Each section header shows its session count whether the section is expanded
    or collapsed. Sections collapse independently; the state is remembered in
    local storage, and search temporarily forces every section open without
    overwriting the saved state.
12. Deleting a session requires confirmation and permanently removes its
    messages.
13. The Inbox button targets the newest Inbox session for the current project by
    update time, independent of the sidebar search. It never navigates to itself.

## Edge cases

- **No projects** — an empty state explains that a directory must be opened with
  OpenCode first.
- **No sessions** — the list invites the person to create one.
- **No Inbox sessions** — the Inbox button stays visible but greyed out.
- **Already on the newest Inbox session** — the Inbox button is greyed out even
  when older Inbox sessions exist.
- **Inbox still loading** — the Inbox button stays disabled until sessions and
  mailbox signals resolve.
- **No draft sessions** — the Drafts section shows a small empty state.
- **Search with no matches** — the list says so without clearing the query.
- **Search active** — every section is temporarily expanded so matching titles
  are visible; clearing the search restores the saved collapse state.
- **Project removed from the server** — the project page shows "Project not
  found" with a way home.
- **Session deleted elsewhere** — the chat route reports "Session not found" and
  offers the project page.
- **Session reports `projectID: "global"`** — links use the selected project ID,
  not the session field.
- **Session creation fails** — the button returns to its normal state and no
  navigation happens.
- **Session request fails** — the list shows a retry link instead of an empty
  state.
- **Message lookup fails** — an idle session falls back to Inbox instead of
  disappearing; a running session stays in Outbox.
- **Saving a draft** — the session stays in Drafts because the message is queued
  in the session inbox and no transcript message exists yet.
- **Starting a draft** — the queued draft is delivered, the Start message is
  added, and the session moves to Outbox as the run starts.
- **Sending a prompt** — the session moves to Outbox as soon as the message is
  accepted, before the first assistant token.
- **Run streaming** — the session stays in Outbox while assistant messages
  arrive and returns to Inbox only when the run ends.
- **Waiting on an approval or question** — the session moves to Inbox while the
  run is still active and returns to Outbox after the reply.
- **Run interrupted** — once idle, the latest message decides: agent-last moves
  to Inbox and user-last stays in Outbox.
- **Latest run failed** — the Inbox row shows a red dot instead of grey; once a
  newer user or successful assistant message arrives, the dot returns to the
  normal state.
- **Very long titles** — rows and cards truncate or clamp; the full title is in
  the chat header.
- **Archived sessions** — shown only in the Archived section.
- **Reopened sessions** — return to Inbox, Outbox, or Drafts with their title
  unchanged, including any `[DONE]` suffix.
- **Done or Reopen while running** — both are hidden until the run finishes.
- **Done on an empty session** — the session is deleted rather than archived,
  and the start view returns.
- **New session** — creates the session and opens the reply composer in the
  last-used size so the first prompt can be typed immediately.
- **Messages fail to load** — the chat reports the failure and hides Done so a
  real session is not mistaken for an empty one.

## Out of scope

- Bulk actions
- Workspaces, worktrees, or moving sessions between projects
- Sharing, export, or import
- Organizing sessions into folders or tags

## Known gaps

- The 50-session cap is not discoverable; older sessions can only be found by
  search.
- The active and archived lists each cap at 50 sessions.
- Session cards do not show a message count; that lives in the chat info panel.
- Saved drafts cannot be edited or cancelled from Clara yet; start the draft or
  delete the session.

## Technical appendix

<details>
<summary>Routes, data, and references</summary>

- Routes: `/`, `/p/:projectId`, `/p/:projectId/s/:sessionId`
- Active list: `client.session.list({ directory, search, archived: false, limit: 50 })`
- Archived list: `client.session.list({ directory, search, archived: true, limit: 50 })`
- Mailbox signals: `client.message.list({ sessionID, order: 'desc', limit: 1, type })`
  for `user` and `assistant`, plus `client.session.form.list({ sessionID })`
- Pending drafts: `client.session.inbox.list({ sessionID })`
- Save draft: `client.session.prompt({ sessionID, text, files, resume: false })`
- Start draft: `client.session.prompt({ sessionID, text: 'Start', delivery: 'steer' })`
- Running state: `client.session.active()`, refreshed on `session.execution.*`,
  `session.status`, and `session.idle` events
- Awaiting input: `client.permission.request.list({ location: { directory } })`
  and pending forms
- Create: `client.session.create({ location: { directory }, agent, model })`
- Update: `client.session.update({ sessionID, title?, archived? })`
- Done: `client.session.update({ sessionID, title: '<title> [DONE]', archived: true })`
- Reopen: `client.session.update({ sessionID, archived: false })` — title untouched
- Done on empty: `client.session.remove({ sessionID })`
- Delete: `client.session.remove({ sessionID })`
- Active map: `client.session.active()`
- Inbox shortcut: `src/features/sessions/use-inbox-sessions.ts`,
  `src/components/chat/inbox-jump-button.tsx`
- Inbox alerts: see [notifications](notifications.md)
- Section state: `clara.sidebarSections` in `localStorage`
- Sidebar width: `clara.sidebarWidth` in `localStorage` (clamped to 208–480px,
  default 288px)
- Related: [capabilities](capabilities.md), [chat](chat.md)

</details>
