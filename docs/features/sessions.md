# Sessions

## Summary

The project and session browser is how people find their work. Projects group
sessions by the directory the harness opened; sessions are the units of conversation
that Clara opens in the chat view. The sidebar switcher keeps the seven most
recently active non-empty projects, while the All projects page shows every
non-empty project with session counts and server-side rename. A filter on the
projects header reveals empty projects. The interface calls sessions **Briefs**
by default, and the noun is configurable in Settings. A shift-click selects a
range of sessions from an anchor, and Delete or Backspace permanently removes
the selection after an explicit confirmation; the resting list has no checkbox
column or bulk toolbar.

## User flow

1. After connecting, Clara shows the **Start a new session** view with the last
   project or the first project selected in the sidebar.
2. The sidebar project button opens a menu of the seven most recently active
   projects, skipping projects without sessions by default, plus the current
   project when it falls outside that window. Each row shows its name and
   canonical path; **All projects** at the end opens the projects page.
3. Choosing a project loads its sessions into five collapsible mailbox
   sections: Inbox, Outbox, Drafts, Snoozed, and Archived. While the
   orchestration service is reachable, worker sessions are removed from those
   sections and shown in a separately anchored **Workers** section at the bottom
   of the sidebar.
4. Inbox holds sessions that need the person: a pending approval or question,
   or an idle session whose latest conversational message is from the agent.
   Outbox holds sessions where the agent still owes a reply, including every
   running session. Unread Inbox sessions use a heavier title weight until the
   person opens them.
5. Drafts holds empty sessions and sessions with a saved no-reply draft that
   has not produced a projected message yet. Snoozed holds sessions postponed
   with the server's `snoozed` metadata. Archived holds sessions archived on the
   server and wins over Snoozed when both apply.
6. Workers sits above the sidebar footer. Only its trigger shows when the section
   is closed, resting at the bottom edge; opening it raises the header and
   reveals the session rows underneath, so the rows read as part of Workers
   rather than the tail of Archived. The rows keep the same running, blocked,
   and error dots as the mailbox sections.
7. The search box filters sessions by title using the server's search parameter
   and temporarily expands every section so matching titles are visible. A
   toggle button beside the search box opens or closes every section at once;
   it is disabled while a search is active.
8. **New session** creates a session in the selected project and opens the reply
   composer in the last-used size (expanded by default), ready for the first
   prompt; the empty session appears in Drafts. Creating the session re-targets
   the composer even when it is already open or minimized on another session.
   Opening an empty draft with locally saved text opens the composer too.
9. The All projects page shows one card per canonical, non-empty project with
   its directory, last activity, and active/archived session counts. A filter
   icon at the far right of the header opens a **Show empty projects** switch,
   off by default. The card menu renames the project on the harness server; the
   directory does not change.
10. The project page uses the same page shell as Settings and All projects. A
    project info card shows the directory, ID, icon, VCS, commands, sandboxes,
    created/updated/active/archived timestamps, and active/inactive/total session
    counts. Its menu archives every session or deletes every session after
    confirmation; the project record itself stays on the server. Below the card,
    a project settings card edits the icon, avatar color, and workspace startup
    script on the server. Below that, a sessions heading introduces the session
    cards with agent, model, token totals, cost, and update time. Cost follows
    the **Cost display** setting, so a card can show the reported amount or an
    estimate marked with `~`.
11. Opening a session shows it in the sidebar and loads the chat view, or a
    dedicated New message view when it has no messages and no pending draft.
12. A **Monitor Inbox** switch on the start view, below **New Session**, jumps
    to the newest Inbox session when turned on. While active it advances after
    Done, Send, Build, or saving a draft: Clara opens the next newest Inbox
    session, or the start view when the Inbox is empty. It also opens a session
    as soon as it newly enters the Inbox while the start view is open; sessions
    already in the Inbox when the view opens never redirect. Manual navigation is
    otherwise never redirected. The switch shows whether monitoring is active
    whenever the start view is shown, and reports how many agents are working in
    the project's Outbox with a pulsing dot while any run is active.
13. The chat header can rename, snooze, archive, or delete the current session. A
    home button to the left of the title returns to the start view.
14. The Done button in the reply dock archives the session without renaming it,
    briefly celebrates, and returns to the start view (or opens the next Inbox
    session while Monitor Inbox is active). An empty draft shows a simple
    **Delete** action instead, which removes the session immediately.
15. Opening an archived or snoozed session shows a Reopen button next to Reply.
    Reopening clears the server's archived and snoozed flags as applicable and
    leaves the title untouched.
16. A normal click opens the session and makes its row the selection anchor.
    Shift-click another row to select the inclusive rendered range from the
    anchor to that row without navigating; the range runs in section order
    (Inbox, Outbox, Drafts, Snoozed, Archived, then Workers) and collapses
    contribute no rows. Shift+Enter on a focused row extends the selection the
    same way.
17. While a selection exists, a compact bar above the list shows the count in
    the configured session noun, the hint **Press Delete or Backspace to
    delete**, Clear, and a Delete action. Selected rows use a destructive tint
    and ring. Clear removes the selection and the anchor.
18. Delete or Backspace with a non-empty selection and focus outside a
    text-entry target opens a confirmation dialog, unless another Clara dialog,
    menu, popover, select, or sheet is already open. Escape, Cancel, the close
    control, and clicking outside dismiss it without a write. The dialog keeps
    the count it opened with through its close animation.
19. Confirming runs one `session.remove` per session, four at a time. Success
    clears the selection, moves focus to a surviving row, and reports the count;
    partial failure keeps the failed rows selected, names them in a toast and
    the selection bar, and focuses the first failed row. Dismissal focuses the
    row that opened the dialog or the first selected row, never the destructive
    action. Clear and Delete keep 44px touch targets in the mobile drawer.
20. The mobile drawer keeps its own selection and clears it when it closes.

## Core business rules

1. Sessions are fetched by **project ID**. A project can own sessions in its
   canonical directory, git worktrees, and sandboxes; a directory query is exact
   and would hide sessions after an agent moves one to a worktree. The hub maps
   the Clara project to every harness project record for that canonical path,
   merges their session pages, deduplicates by id, and keeps one cursor per
   record. If the links are missing, the hub rebuilds them from the project list
   once; a project that still has no record returns `project_unmapped` instead
   of an empty list.
2. The active list requests the newest 50 non-archived sessions from each linked
   record and shows the merged result; the archived list does the same for
   archived sessions.
3. A new session inherits the model of the most recent active session in the
   project, so the first prompt uses a model that already works. A model hidden
   in **Settings → Models** is not inherited; the new session starts on the
   server default instead. Its agent follows the **Default agent** setting: the
   last agent selected anywhere in Clara, or a specific agent. A specific agent
   also replaces the agent of an empty draft the first time that draft is
   opened. Sessions that already have messages are never changed.
4. Running sessions are marked with a live dot driven by the active-session map
   and status events, and that same map keeps them in Outbox. Inbox rows show
   what they need: a red pulsing dot while a run is blocked on an approval or
   question, a red dot when the latest message is a failed run, an orange dot
   when a finished Plan reply is waiting for Steer or Build, and a grey dot for
   an idle session to review and close. The error dot is reserved for failed
   last messages; it does not apply to older errors already followed by a reply.
   Unread Inbox sessions use a heavier title weight; opening the chat marks the
   newest completed turn viewed. These states also drive Inbox alerts; see
   [notifications](notifications.md).
5. Inbox, Outbox, and Drafts combine the latest `user` or `assistant` message
   with live run state. A pending permission or form request puts the session in
   Inbox; a running session stays in Outbox even after the agent writes; once
   idle, the latest message author decides (agent → Inbox, user → Outbox).
   Internal messages such as `idle`, `system`, and model switches are ignored.
   A follow-up queued from the composer while a run is active is a pending inbox
   item; the harness promotes it as the next turn when the session would otherwise
   become idle.
6. Drafts contains sessions with no projected user or assistant messages that
   are not running. This includes new empty sessions and sessions whose first
   message was saved with the harness's no-reply mode and still sits in the session
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
12. Deleting one session or a shift-click range requires an explicit
    confirmation and permanently removes those sessions and their messages.
    Selection is local to the sidebar instance: a normal click clears it and
    sets the anchor, shift-click or Shift+Enter selects the inclusive rendered
    range from that anchor, Clear and a project or search change clear it, and a
    successful list refresh prunes IDs that disappeared. The dialog snapshots
    the selection when it opens, keeps that snapshot through dismissal so it
    never flashes a zero count, focuses Cancel, and cannot be dismissed or
    submitted twice while deletion runs. Focus returns to a row or Clear, never
    the destructive action. Pruning a vanished selection also clears the failure
    note. Partial failures continue the batch, keep the failed sessions selected,
    and name the failures. Deleting the open session returns to its project
    page.
13. Monitor Inbox targets the newest Inbox session for the current project by
    update time, independent of the sidebar search. It moves the open view when
    the toggle is turned on, after Done, Send, Build, or saving a draft, or when
    a session newly enters the Inbox while the start view is open. The first
    actions open the next newest Inbox session, or the start view when none
    remain. Sessions already in the Inbox when the start view opens never
    redirect, so manual navigation and the switch stay usable. The preference is
    remembered in local storage. The switch also shows the current Outbox count
    as “N agents working” (or “No agents working”) for the project.
14. Snoozed sessions leave Inbox, Outbox, and Drafts until they are reopened or
    engaged. Sending a reply, starting work, requesting a plan, running a
    command, saving a draft, or answering a permission or question clears the
    snooze marker first, so the session returns to whichever section its state
    implies. Archived wins when a session is both archived and snoozed. Snoozed
    sessions do not trigger desktop notifications, inbox sounds, or Monitor
    Inbox.
15. The interface calls a session a **Brief** by default. Settings → Session
    wording replaces that noun in every user-facing label, placeholder, toast,
    and notification. The setting offers Brief, Task, Session, Action, Run, and
    Job presets or any custom singular word, derives the plural, and stores the
    choice in the browser. The harness API and Clara's internal code still use
    `session`.
16. Project recency comes from the server's `time.active`; the switcher takes
    the newest seven and pins the current project when it falls outside them.
    The All projects page lists every canonical, non-archived project. Projects
    with zero total sessions are hidden from both views by default; the header
    filter reveals them and saves the choice on the device. The current project
    stays pinned in the switcher even when it is empty. Project names are saved
    with `client.project.update` on the harness server, so a rename reaches
    every Clara client and never becomes a local-only label. Session counts split
    on `time.archived`; the statistics request is capped and the total shows `+`
    when it reaches the cap.
17. Project bulk actions are session-level only. The harness has no project
    archive or delete endpoint. **Archive all sessions** archives every
    non-archived session in the project, and **Delete all sessions** permanently
    deletes every session. Both actions load every page of the project's session
    list before writing, run four writes at a time, and leave the project record
    and directory untouched.
18. Project settings are shared server metadata. Clara writes a custom icon to
    `icon.override` as a 128×128 PNG data URL, writes one of six harness
    avatar colors to `icon.color`, and writes the workspace startup command to
    `commands.start`. It never writes the server-discovered `icon.url`.
19. While the orchestration service is reachable, a session whose metadata says
    `automation === true` never enters Inbox, Outbox, Drafts, Snoozed, or
    Archived. It stays in Workers even when archived, and New session does not
    inherit its agent or model. When the Orchestration switch is off, the same
    session is treated as an ordinary session and returns to the normal mailbox
    groups.
    Removing a custom image reveals the selected color or discovered favicon.
    Every project avatar in the sidebar, All projects cards, and project page
    follows that order.
20. The harness runs `commands.start` after it creates a new worktree. Clara does
    not create worktrees, so New brief does not run the startup script; the
    setting is for the harness desktop app, the CLI, and future workspace support.
21. The harness hides a project from `project.list()` after its directory has been
    missing for an hour, and restores it when a directory-scoped request
    resolves the directory again. On connect and from **Refresh projects**,
    Clara lists archived projects and probes each canonical directory with
    `location.get`. Projects whose directory is back return to the active list;
    directories that are still missing stay archived and hidden.
22. Mailbox lookups run within a shared request budget instead of launching
    three requests per session at once. A failed background refresh keeps the
    last list visible with a compact refresh notice; the full retry state appears
    only when no list is cached.

## Edge cases

- **No projects** — an empty state explains that a directory must be opened with
  the harness first.
- **Project directory returns** — Clara restores the project on connect or when
  **Refresh projects** runs in the switcher, without another server restart.
- **Project directory is still missing** — the project stays archived and hidden;
  a failed directory probe is treated as unavailable, not as an error.
- **Selected project outside the recent seven** — the switcher keeps it visible
  by replacing the seventh recent entry.
- **Project rename fails** — the dialog reports the error and the old name stays
  in place.
- **Project renamed on another client** — the `project.updated` event refreshes
  the switcher and the All projects cards.
- **Project icon image cannot be read or is too large** — the settings card
  reports the problem and keeps the previous icon.
- **Project icon save fails** — the preview returns to the server's icon and a
  toast reports the failure.
- **Project has a color and a discovered favicon** — the color avatar wins in
  Clara, matching the harness; choosing **Default** reveals the favicon again.
- **Custom project icon removed** — only `icon.override` is cleared; the
  discovered favicon and selected color stay on the server.
- **Startup script save fails** — the input keeps the text and a toast reports
  the failure.
- **Project metadata changes on another client** — the `project.updated` event
  refreshes the project page and every project avatar.
- **Project has no sessions** — it is hidden by default; when revealed, its card
  shows zero active and zero archived.
- **Every project is empty** — the All projects page shows a filter-aware empty
  state with a **Show empty projects** action.
- **Session lookup fails** — the project stays visible instead of disappearing.
- **Current project is empty** — the switcher keeps it pinned while hiding other
  empty projects.
- **Project gains or loses its last session** — session events refresh the
  empty-state check without a page reload.
- **More than the statistics cap** — counts are shown with a `+` because the
  request is bounded.
- **Project statistics fail** — the card keeps its directory and rename action
  and shows that counts are unavailable.
- **Archive all sessions fails partway** — the toast reports the failure; a retry
  only writes sessions that are still not archived.
- **Delete all sessions fails partway** — deleted sessions stay gone and the
  remaining sessions stay in the project; a retry lists what is left.
- **A project has more sessions than one page** — both bulk actions follow every
  server cursor before writing, so no page is skipped.
- **Project record cannot be archived or deleted** — the confirmation text says
  the project itself stays; only its sessions change.
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
- **Duplicate project records for one directory** — Clara merges the sessions
  from every record, so selecting any duplicate shows the same complete list.
- **Project has no harness record** — the session list reports
  `project_unmapped` with a retry instead of showing an empty project.
- **Session creation fails** — the button returns to its normal state and no
  navigation happens.
- **Session refresh fails** — the last list stays visible with a compact refresh
  notice and the error reason. The full retry state is used only when nothing is
  cached.
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
  also carry snooze metadata. An automation worker is the exception: while
  orchestration is reachable it stays in Workers.
- **Snoozed sessions** — shown only in the Snoozed section until reopened; they
  keep their title, messages, and run state.
- **Orchestration off** — automation sessions lose the Workers treatment and
  behave like ordinary sessions in every mailbox group.
- **Snoozed and archived** — Archived wins; reopening the session clears both
  flags and returns it to its mailbox bucket.
- **Snoozing while running** — the run continues but the session stays out of
  Outbox and inbox alerts; Reopen remains hidden until the run finishes.
- **Reopened sessions** — return to Inbox, Outbox, or Drafts with their title
  unchanged.
- **Done or Reopen while running** — both are hidden until the run finishes.
- **Delete on an empty draft** — the session is removed immediately rather than
  archived, and the start view returns.
- **Shift-click with no anchor** — the clicked session becomes the anchor and the
  only selected row.
- **Shift-click across collapsed sections** — rows in a collapsed section are
  skipped; a selection made before collapsing survives and stays counted until
  the next shift-click replaces it.
- **Selected session moves or disappears** — selection is keyed by ID, so it
  follows a live reorder; a successful refresh prunes sessions that no longer
  exist and clears the failure note when pruning changes the selection, while a
  failed refresh keeps the last known selection.
- **Confirmation with an empty snapshot** — the dialog renders no content and no
  write starts.
- **Viewport drops below `md` with a desktop selection** — the hidden desktop
  sidebar becomes inert; only the mobile drawer's own selection can open the
  dialog.
- **Delete or Backspace in search, the composer, or contenteditable text** — the
  shortcut is ignored, as it is for Ctrl, Meta, or Alt, key auto-repeat, IME
  composition, an open dialog or menu, or a deletion already running.
- **Partial bulk delete failure** — successful sessions disappear, failed rows
  stay selected with their titles in the toast, and retrying acts only on what
  remains.
- **Open session deleted in a batch** — Clara closes the dialog, shows the
  result, and routes to the project page; if that session failed, the chat stays
  open.
- **New session** — creates the session and opens the reply composer in the
  last-used size so the first prompt can be typed immediately. An already-open
  composer follows the new session; plain session navigation does not move it.
- **Messages fail to load** — the chat reports the failure and hides Done so a
  real session is not mistaken for an empty one.

## Out of scope

- Bulk actions other than project archive-all/delete-all and the sidebar's
  shift-click range deletion
- Clara-hosted project images, arbitrary avatar colors, or running the workspace
  startup script from Clara
- Creating, switching, or removing worktrees, or moving sessions between
  projects
- Sharing, export, or import
- Organizing sessions into folders or tags

## Known gaps

- The 50-session cap is not discoverable; older sessions can only be found by
  search.
- The workspace startup script set on the project page is not run by Clara's
  New brief action because Clara does not create worktrees.
- The active and archived lists each cap at 50 sessions.
- Session cards do not show a message count; that lives in the chat info panel.
- Saved drafts cannot be edited or cancelled from Clara yet; start the draft or
  delete the session.

## Technical appendix

<details>
<summary>Routes, data, and references</summary>

- Routes: `/`, `/projects`, `/p/:projectId`, `/p/:projectId/s/:sessionId`
- Projects: `client.project.list()` sorted by `time.active`; the switcher takes
  seven and pins the current project when needed; duplicate canonical records
  resolve to the VCS-backed one
- Project reconciliation: `client.project.list({ archived: true })` then
  `client.location.get({ location: { directory } })` for each archived project,
  three at a time with a 5s timeout; resolving a directory clears
  `time.archived`, while a missing directory returns 404 and stays archived
- Refresh projects: the project switcher item reruns reconciliation and
  invalidates the project list when at least one project comes back
- Project update: `client.project.update({ projectID, name?, icon?, commands? })`;
  the `project.updated` event invalidates the cached project list
- Project icon: `icon.override` holds a custom image as a 128×128 PNG data URL;
  `icon.url` is a server-discovered favicon that Clara never writes; `icon.color`
  is one of `pink`, `mint`, `orange`, `purple`, `cyan`, or `lime`
- Icon upload: `apps/web/src/features/projects/project-icon.ts` resizes,
  center-crops, rejects inputs over 5 MB or results over 256 KB, and re-encodes
  as PNG
- Workspace startup script: `commands.start`, capped at 4,096 characters in the
  settings input; the harness runs it after creating a new worktree
- Project statistics: `client.session.list({ project: projectID, limit: 1000 })`
  counted by `time.archived`; the total shows `+` at the cap
- Project page: `PageShell` with a `ProjectInfoCard` and `ProjectSettingsCard`;
  metadata comes from `client.project.list()`, counts from the project statistics
  query
- Project actions: every session is loaded with
  `client.session.list({ project: projectID, limit: 200, cursor })` until the
  server returns no next cursor; archive-all calls
  `session.update({ sessionID, archived: true })` for non-archived sessions and
  delete-all calls `session.remove({ sessionID })`, four writes at a time
- Empty project check: `client.session.list({ project: projectID, limit: 1 })`;
  any result keeps the project visible. Failed lookups fail open.
- Empty project filter: `clara.showEmptyProjects` in `localStorage` (`shown` or
  `hidden`, default `hidden`)
- Active list: `client.session.list({ project: projectID, search, archived: false, limit: 50 })`;
  includes snoozed sessions and sessions in worktrees or sandboxes
- Archived list: `client.session.list({ project: projectID, search, archived: true, limit: 50 })`
- Mailbox signals: `client.message.list({ sessionID, order: 'desc', limit: 1, type })`
  for `user` and `assistant`, plus `client.session.form.list({ sessionID })`
- Automation grouping: `session.metadata.automation === true`; applied only
  when hub info reports `orchestration === true`. The predicate is checked
  before archived and snoozed, so workers never enter a mailbox group while the
  service is reachable.
- Workers section: anchored above the sidebar footer, closed by default. Its
  header is first in the drawer, so opening raises the header and lays the rows
  out beneath it; the body caps at `min(16rem, 45dvh)` with its own scroll. It is
  included in search and the open/close-all toggle.
- Pending drafts: `client.session.inbox.list({ sessionID })`
- Save draft: `client.session.prompt({ sessionID, text, files, resume: false })`
- Start draft: `client.session.synthetic({ sessionID, text, description,
metadata, delivery: 'steer' })`
- Running state: `client.session.active()`, refreshed on `session.execution.*`,
  `session.status`, and `session.idle` events
- Awaiting input: `client.permission.request.list({ location: { directory } })`
  and pending forms
- Create: `client.session.create({ location: { directory }, agent, model })`
  with `agent` resolved from `clara.defaultAgent` and `clara.lastAgent` in
  `localStorage`
- Update: `client.session.update({ sessionID, title?, metadata?, archived? })` —
  metadata replaces the stored object, so snooze writes merge the current keys
- Snooze: `client.session.update({ sessionID, metadata: { ...existing, snoozed: true } })`
- Unsnooze: `client.session.update({ sessionID, metadata: withoutSnoozed })`;
  prompts, commands, draft saves, permission decisions, and question answers do
  this first through `src/features/sessions/unsnooze.ts`
- Done: `client.session.update({ sessionID, archived: true })` — title untouched
- Reopen: `client.session.update({ sessionID, archived: false, metadata? })` —
  clears archived and any snooze metadata; title untouched
- Delete empty draft: `client.session.remove({ sessionID })`
- Local composer draft: `clara.draft.<sessionID>` in `localStorage`
- Delete: `client.session.remove({ sessionID })`
- Sidebar selection: `selectRange` and `pruneSelection` in
  `src/features/sessions/session-selection.ts`; state is local to the sidebar
  instance and is not persisted
- Sidebar bulk delete: `deleteSessions`,
  `invalidateDeletedSessions`, and `useDeleteSessions` in
  `src/features/sessions/use-delete-sessions.ts`; four writes at a time through
  `runWithConcurrencySettled` in `src/lib/concurrency.ts`, then one `['sessions']`
  invalidation plus each successful `['session', id]` query
- Sidebar components: `sidebar-selection-bar.tsx`, `sidebar-delete-dialog.tsx`,
  and the selection props on `sidebar-session-row.tsx`; Delete/Backspace is
  ignored for text-entry targets and open Clara dialogs, menus, popovers,
  selects, or sheets
- Focus helper: `resolveDeleteFocusTarget` in
  `src/features/sessions/delete-focus.ts`; result copy is
  `describeDeleteOutcome` in `use-delete-sessions.ts`
- Active map: `client.session.active()`
- Inbox monitor: `src/features/sessions/inbox-monitor.tsx`,
  `src/components/chat/inbox-monitor-toggle.tsx`, and
  `src/features/sessions/use-inbox-sessions.ts`
- Monitor preference: `clara.monitorInbox` in `localStorage` (`on` or `off`)
- Session wording: `clara.sessionWording` in `localStorage` (default `Brief`;
  custom singular word, plural derived automatically)
- Inbox alerts: see [notifications](notifications.md)
- Unread Inbox sessions: `isSessionUnread` in
  `src/features/sessions/session-unread.ts` (`time.idle` newer than
  `time.viewed`); `useMarkSessionViewed` calls
  `client.session.view({ sessionID, idle })` while the chat is visible and
  focused, and `session.viewed` invalidates the session queries
- Section state: `clara.sidebarSections` in `localStorage`
- Sidebar width: `clara.sidebarWidth` in `localStorage` (clamped to 208–480px,
  default 288px)
- Related: [capabilities](capabilities.md), [chat](chat.md)

</details>
