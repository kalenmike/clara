# Sessions

## Summary

The project and session browser is how people find their work. Projects group
sessions by the directory OpenCode opened; sessions are the units of conversation
that Clara opens in the chat view. The interface calls them **Briefs** by
default, and the noun is configurable in Settings.

## User flow

1. After connecting, Clara shows the **Start a new session** view with the last
   project or the first project selected in the sidebar.
2. The sidebar project button opens a menu of every project the server knows,
   showing its name and canonical path.
3. Choosing a project loads its sessions into five collapsible sections: Inbox,
   Outbox, Drafts, Snoozed, and Archived.
4. Inbox holds sessions that need the person: a pending approval or question,
   or an idle session whose latest conversational message is from the agent.
   Outbox holds sessions where the agent still owes a reply, including every
   running session.
5. Drafts holds empty sessions and sessions with a saved no-reply draft that
   has not produced a projected message yet. Snoozed holds sessions postponed
   with the server's `snoozed` metadata. Archived holds sessions archived on the
   server and wins over Snoozed when both apply.
6. The search box filters sessions by title using the server's search parameter
   and temporarily expands every section so matching titles are visible. A
   toggle button beside the search box opens or closes every section at once;
   it is disabled while a search is active.
7. **New session** creates a session in the selected project and opens the reply
   composer in the last-used size (expanded by default), ready for the first
   prompt; the empty session appears in Drafts. Opening an empty draft with
   locally saved text opens the composer too.
8. On the project page, sessions also appear as cards with agent, model, token
   totals, cost, and update time.
9. Opening a session shows it in the sidebar and loads the chat view, or a
   dedicated New message view when it has no messages and no pending draft.
10. A **Monitor Inbox** switch on the start view, below **New Session**, jumps
    to the newest Inbox session when turned on. While active it advances after
    Done, Send, Build, or saving a draft: Clara opens the next newest Inbox
    session, or the start view when the Inbox is empty. It also opens a session
    as soon as it newly enters the Inbox while the start view is open; sessions
    already in the Inbox when the view opens never redirect. Manual navigation is
    otherwise never redirected. The switch shows whether monitoring is active
    whenever the start view is shown, and reports how many agents are working in
    the project's Outbox with a pulsing dot while any run is active.
11. The chat header can rename, snooze, archive, or delete the current session. A home
    button to the left of the title returns to the start view.
12. The Done button in the reply dock archives the session without renaming it,
    briefly celebrates, and returns to the start view (or opens the next Inbox
    session while Monitor Inbox is active). An empty draft shows a simple
    **Delete** action instead, which removes the session immediately.
13. Opening an archived or snoozed session shows a Reopen button next to Reply.
    Reopening clears the server's archived and snoozed flags as applicable and
    leaves the title untouched.

## Core business rules

1. Sessions are fetched by **project ID**. A project can own sessions in its
   canonical directory, git worktrees, and sandboxes; a directory query is exact
   and would hide sessions after an agent moves one to a worktree. When the
   server holds duplicate records for the same canonical path, Clara uses the
   VCS-backed record.
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
7. Archive state comes only from the server's `archived` timestamp, and snooze
   state only from `metadata.snoozed === true`. Title text, including any legacy
   `[DONE]` or `(DONE)` suffix, never moves a session out of Inbox on its own.
8. Done sets the server's archived flag without changing the title, and returns
   to the start view after a short celebration delay, or opens the next Inbox
   session when Monitor Inbox is active. An empty, non-archived draft shows
   **Delete** instead; it removes the session immediately. Done is hidden while
   the agent is running and on snoozed sessions.
9. Reopening clears the archived flag and any snooze metadata, and does not
   rename the session. Reopen is available only while the reply window is closed
   and the agent is idle.
10. A session without projected messages and without a pending draft shows a
    dedicated New message view instead of the chat. **New** replaces Reply and
    opens the composer in the last-used size; opening the draft with locally
    saved text opens the composer automatically. A new session skips this step
    and opens the composer immediately.
11. Each section header shows its session count whether the section is expanded
    or collapsed. Sections collapse independently; the toggle beside the search
    box opens or closes all of them at once, and both actions are remembered in
    local storage. Search temporarily forces every section open without
    overwriting the saved state.
12. Deleting a session requires confirmation and permanently removes its
    messages.
13. Monitor Inbox targets the newest Inbox session for the current project by
    update time, independent of the sidebar search. It moves the open view when
    the toggle is turned on, after Done, Send, Build, or saving a draft, or when
    a session newly enters the Inbox while the start view is open. The first
    actions open the next newest Inbox session, or the start view when none
    remain. Sessions already in the Inbox when the start view opens never
    redirect, so manual navigation and the switch stay usable. The preference is
    remembered in local storage. The switch also shows the current Outbox count
    as “N agents working” (or “No agents working”) for the project.
14. Snoozed sessions leave Inbox, Outbox, and Drafts until they are reopened.
    Archived wins when a session is both archived and snoozed. Snoozed sessions
    do not trigger desktop notifications, inbox sounds, or Monitor Inbox.
15. The interface calls a session a **Brief** by default. Settings → Session
    wording replaces that noun in every user-facing label, placeholder, toast,
    and notification. The setting offers Brief, Task, Session, Action, Run, and
    Job presets or any custom singular word, derives the plural, and stores the
    choice in the browser. OpenCode's API and Clara's internal code still use
    `session`.

## Edge cases

- **No projects** — an empty state explains that a directory must be opened with
  OpenCode first.
- **No sessions** — the list invites the person to create one.
- **Custom wording is blank** — Clara falls back to the current or default noun
  instead of saving an empty label.
- **No Inbox sessions while monitoring** — Clara shows the start view with the
  Monitor Inbox switch still on, so monitoring can be turned off. The next
  session to enter the Inbox opens automatically.
- **Open session leaves the Inbox** — Done, Send, Build, and saving a draft open
  the next newest Inbox session.
- **A newer Inbox session arrives while a session is open** — the open session
  stays in place.
- **A session enters the Inbox while the start view is open** — Clara opens it.
  Sessions already in the Inbox when the view opens stay put.
- **Manual navigation while monitoring** — opening a session outside the Inbox,
  starting a new session, or opening Settings stays where the person navigated.
- **Home button** — the chat header link returns to the start view without
  changing the monitoring preference.
- **Inbox still loading on activation** — Clara waits for sessions and mailbox
  signals, then jumps once; navigating before they resolve cancels the jump.
- **Inbox request fails** — Clara keeps the current view and the switch keeps
  its saved state.
- **Monitoring remembered after reload** — the active state is restored without
  redirecting for sessions already in the Inbox. A later arrival still opens
  when the start view is shown.
- **No draft sessions** — the Drafts section shows a small empty state.
- **Search with no matches** — the list says so without clearing the query.
- **Search active** — every section is temporarily expanded so matching titles
  are visible; clearing the search restores the saved collapse state.
- **Project removed from the server** — the project page shows "Project not
  found" with a way home.
- **Session deleted elsewhere** — the chat route reports "Session not found" and
  offers the project page.
- **Session reports `projectID: "global"`** — sidebar links use the selected
  project ID; notifications resolve the project from the session and its
  directory.
- **Agent moves a session to a worktree** — its project ID is unchanged, so it
  stays in the project's list, search, and Inbox. The chat uses the worktree
  directory for Git, mentions, skills, and approvals.
- **Duplicate project records for one directory** — Clara lists and remembers
  the VCS-backed record, so selecting either duplicate shows the same sessions.
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
- **Archived sessions** — shown only in the Archived section, even when they
  also carry snooze metadata.
- **Snoozed sessions** — shown only in the Snoozed section until reopened; they
  keep their title, messages, and run state.
- **Snoozed and archived** — Archived wins; reopening the session clears both
  flags and returns it to its mailbox bucket.
- **Snoozing while running** — the run continues but the session stays out of
  Outbox and inbox alerts; Reopen remains hidden until the run finishes.
- **Reopened sessions** — return to Inbox, Outbox, or Drafts with their title
  unchanged.
- **Done or Reopen while running** — both are hidden until the run finishes.
- **Delete on an empty draft** — the session is removed immediately rather than
  archived, and the start view returns.
- **New session** — creates the session and opens the reply composer in the
  last-used size so the first prompt can be typed immediately.
- **Messages fail to load** — the chat reports the failure and hides Done so a
  real session is not mistaken for an empty one.

## Out of scope

- Bulk actions
- Creating, switching, or removing worktrees, or moving sessions between
  projects
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
- Active list: `client.session.list({ project: projectID, search, archived: false, limit: 50 })`;
  includes snoozed sessions and sessions in worktrees or sandboxes
- Archived list: `client.session.list({ project: projectID, search, archived: true, limit: 50 })`
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
- Update: `client.session.update({ sessionID, title?, metadata?, archived? })` —
  metadata replaces the stored object, so snooze writes merge the current keys
- Snooze: `client.session.update({ sessionID, metadata: { ...existing, snoozed: true } })`
- Unsnooze: `client.session.update({ sessionID, metadata: withoutSnoozed })`
- Done: `client.session.update({ sessionID, archived: true })` — title untouched
- Reopen: `client.session.update({ sessionID, archived: false, metadata? })` —
  clears archived and any snooze metadata; title untouched
- Delete empty draft: `client.session.remove({ sessionID })`
- Local composer draft: `clara.draft.<sessionID>` in `localStorage`
- Delete: `client.session.remove({ sessionID })`
- Active map: `client.session.active()`
- Inbox monitor: `src/features/sessions/inbox-monitor.tsx`,
  `src/components/chat/inbox-monitor-toggle.tsx`, and
  `src/features/sessions/use-inbox-sessions.ts`
- Monitor preference: `clara.monitorInbox` in `localStorage` (`on` or `off`)
- Session wording: `clara.sessionWording` in `localStorage` (default `Brief`;
  custom singular word, plural derived automatically)
- Inbox alerts: see [notifications](notifications.md)
- Section state: `clara.sidebarSections` in `localStorage`
- Sidebar width: `clara.sidebarWidth` in `localStorage` (clamped to 208–480px,
  default 288px)
- Related: [capabilities](capabilities.md), [chat](chat.md)

</details>
