# Sessions

## Summary

The project and session browser is how people find their work. A Clara project
is a user-owned container; each workspace inside it links the project to a
directory on one paired harness, and a project can hold workspaces on several
harnesses, of any kind, on different machines. Sessions are the units of
conversation that Clara opens in the chat view. The sidebar switcher keeps the
seven most recently active non-empty projects, while the All projects page shows
every non-empty project with session counts, workspace management, and Clara-side
rename. A
filter on the projects header reveals empty and archived projects. The interface
calls sessions **Briefs** by default, and the noun is configurable in Settings. A
shift-click selects a range of sessions from an anchor, and Delete or Backspace
permanently removes the selection after an explicit confirmation; the resting
list has no checkbox column or bulk toolbar.

## User flow

1. After connecting, Clara shows the **Start a new session** view with the last
   project or the first project selected in the sidebar.
2. The sidebar project button opens a menu of the seven most recently active
   projects, skipping projects without sessions by default, plus the current
   project when it falls outside that window. Each row shows its name and its
   first workspace, labelled with the harness when the project spans more than
   one; **New project** and **All projects** end the menu.
3. Choosing a project loads its sessions into five collapsible mailbox
   sections: Inbox, Outbox, Drafts, Snoozed, and Archived. Orchestration worker
   sessions are ordinary sessions in this client; the dedicated engine
   surface is responsible for their separate view.
4. Inbox holds sessions that need the person: a pending approval or question,
   or an idle session whose latest conversational message is from the agent.
   Outbox holds sessions where the agent still owes a reply, including every
   running session. Unread Inbox sessions use a heavier title weight until the
   person opens them.
5. Drafts holds empty sessions and sessions with a saved no-reply draft that
   has not produced a projected message yet. An untitled session with no user
   or assistant message is discarded when the view leaves it with nothing typed
   or saved, and old ones are swept from the list outside the chat view.
   Selection and idle notes do not count as content. Snoozed holds sessions
   postponed with the server's `snoozed` metadata. Archived holds sessions
   archived on the server and wins over Snoozed when both apply.
6. The search box filters sessions by title using the server's search parameter
   and temporarily expands every section so matching titles are visible. A
   toggle button beside the search box opens or closes every section at once;
   it is disabled while a search is active.
7. **New session** creates a session in the selected project and opens the
   composer pinned at the bottom of the new session, ready for the first prompt;
   the empty session appears in Drafts. When the project has more than one
   workspace, the button opens a menu that lists every linked workspace across
   harnesses, disables the offline and unlinked ones, and starts the session
   where the person chose. Otherwise it starts in the workspace the project last
   used. Creating the session selects and focuses its composer tab. Leaving the
   brief with no user or assistant message, no composer text or attachments, no
   saved draft, and no waiting request removes the empty session instead of
   keeping it in Drafts.
8. The All projects page shows one card per non-empty project with its
   workspace summary, last activity, and active/archived session counts, plus a
   **New project** action. A filter icon at the far right of the header opens
   **Show empty projects** and **Show archived projects** switches, both off by
   default. The card menu renames the project in Clara, adds a workspace, and
   archives, restores, deletes, or removes the project.
9. The project page uses the same page shell as Settings and All projects. A
   project info card shows the container ID, workspace list, default workspace,
   created/updated/active/archived timestamps, and active/inactive/total session
   counts. Each workspace shows its harness, directory, online state, and link
   state, with actions to set the default, sync, or remove it from Clara. The
   card menu archives, restores, deletes, or removes the project. Below the card,
   a project settings card edits the icon, avatar color, and workspace startup
   script in Clara. Below that, a sessions heading introduces the session cards
   with agent, model, token totals, cost, and update time. Cost follows the
   **Cost display** setting, so a card can show the reported amount or an
   estimate marked with `~`.
10. Opening a session shows it in the sidebar and loads the chat view, or a
    dedicated New message view when it has no messages and no pending draft.
11. A **Monitor Inbox** switch on the start view, below **New Session**, jumps
    to the newest Inbox session when turned on. While active it advances after
    Done, Send, Build, or saving a draft: Clara opens the next newest Inbox
    session, or the start view when the Inbox is empty. It also opens a session
    as soon as it newly enters the Inbox while the start view is open; sessions
    already in the Inbox when the view opens never redirect. Manual navigation is
    otherwise never redirected. The switch shows whether monitoring is active
    whenever the start view is shown, and reports how many agents are working in
    the project's Outbox with a pulsing dot while any run is active.
12. The chat header can rename, snooze, archive, or delete the current session. A
    home button to the left of the title returns to the start view.
13. The composer's send menu archives the session without renaming it through
    **Done**, and returns to the start view (or opens the next Inbox session
    while Monitor Inbox is active). An empty draft offers **Delete empty draft**
    instead, which removes the session immediately.
14. Opening an archived or snoozed session offers **Reopen** in the send menu.
    Reopening clears the server's archived and snoozed flags as applicable and
    leaves the title untouched.
15. A normal click opens the session and makes its row the selection anchor.
    Shift-click another row to select the inclusive rendered range from the
    anchor to that row without navigating; the range runs in section order
    (Inbox, Outbox, Drafts, Snoozed, Archived) and collapses contribute no rows.
    Shift+Enter on a focused row extends the selection the same way.
16. While a selection exists, a compact bar above the list shows the count in
    the configured session noun, the hint **Press Delete or Backspace to
    delete**, Clear, and a Delete action. Selected rows use a destructive tint
    and ring. Clear removes the selection and the anchor.
17. Delete or Backspace with a non-empty selection and focus outside a
    text-entry target opens a confirmation dialog, unless another Clara dialog,
    menu, popover, select, or sheet is already open. Escape, Cancel, the close
    control, and clicking outside dismiss it without a write. The dialog keeps
    the count it opened with through its close animation.
18. Confirming runs one `session.remove` per session, four at a time. Success
    clears the selection, moves focus to a surviving row, and reports the count;
    partial failure keeps the failed rows selected, names them in a toast and
    the selection bar, and focuses the first failed row. Dismissal focuses the
    row that opened the dialog or the first selected row, never the destructive
    action. Clear and Delete keep 44px touch targets in the mobile drawer.
19. The mobile drawer keeps its own selection and clears it when it closes.

## Core business rules

1. Sessions are fetched by **Clara project ID**. The hub asks every harness that
   owns a record linked to the project's workspaces, overlays each page with its
   harness, and merges, deduplicates, and orders the rows, keeping one cursor per
   record. A harness that is offline or failing hides only its own rows: the
   response carries per-harness status and the list keeps what the others
   returned. The list fails only when no linked harness answers, and
   `project_unmapped` means the project has no linked record on any paired
   harness. If a workspace has no links yet, the hub resolves it from the
   harness location once and retries.
2. Clara projects are not directories. `clara_projects` stores the container,
   name, icon, commands, startup script, archive state, and default workspace;
   `clara_project_workspaces` stores `(harness, directory, canonical)` links, and
   each link maps to every harness project record for that directory on its own
   harness. Harness project lists never create Clara projects, and a harness
   archive never hides a Clara project.
3. A workspace can be added while its harness is offline. Clara stores the
   directory, shows it as unresolved, and links it through the harness location
   the next time the workspace or project is synced.
4. Project archive and delete are Clara actions that also signal every linked
   harness. The included adapter maps archive to archiving every session in the
   linked project records and delete to deleting every session; the harness
   project record may remain. **Remove from Clara** deletes only the container
   and its workspace links, leaving harness data untouched. Older adapters that
   do not advertise `projects.archive` or `projects.delete` are reported as
   unsupported and never block the Clara-side change.
5. The active list requests the newest 50 non-archived sessions from every linked
   record on every harness and shows the merged result; the archived list does
   the same for archived sessions. A record that cannot be read contributes no
   rows and is named in the per-harness status instead of failing the list.
6. A new session inherits the model of the most recent active session in the
   selected workspace, matching both the harness and the workspace that saved
   it, so the first prompt uses a model that already works there. A workspace
   without an active session starts on the harness default; a model from
   another workspace, harness, or machine is never carried over. A model hidden
   in **Settings → Models** is not inherited either; the new session starts on
   the server default instead. Its agent follows the **Default agent** setting:
   the last agent selected anywhere in Clara, or a specific agent. A specific
   agent also replaces the agent of an empty draft the first time that draft is
   opened. Sessions that already have messages are never changed.
7. Running sessions are marked with a live dot driven by the active-session map
   and status events, and that same map keeps them in Outbox. Inbox rows show
   what they need: a red pulsing dot while a run is blocked on an approval or
   question, a red dot when the latest message is a failed run, an orange dot
   when a finished Plan reply is waiting for Steer or Build, and a grey dot for
   an idle session to review and close. The error dot is reserved for failed
   last messages; it does not apply to older errors already followed by a reply.
   Composer tabs reuse the same mark, so another open session's run state is
   visible without opening it.
   Unread Inbox sessions use a heavier title weight; opening the chat marks the
   newest completed turn viewed. These states also drive Inbox alerts; see
   [notifications](notifications.md).
8. Inbox, Outbox, and Drafts combine the latest `user` or `assistant` message
   with live run state. A pending permission or form request puts the session in
   Inbox; a running session stays in Outbox even after the agent writes; once
   idle, the latest message author decides (agent → Inbox, user → Outbox).
   Internal messages such as `idle`, `system`, and model switches are ignored.
   A follow-up queued from the composer while a run is active is a pending inbox
   item; the harness promotes it as the next turn when the session would otherwise
   become idle.
9. Drafts contains sessions with no projected user or assistant messages that
   are not running. This includes new empty sessions and sessions whose first
   message was saved with the harness's no-reply mode and still sits in the session
   inbox. The queued message is shown in the chat and can be started from the
   Start panel.
10. Archive state comes only from the server's `archived` timestamp, and snooze
    state only from `metadata.snoozed === true`. Title text, including any legacy
    `[DONE]` or `(DONE)` suffix, never moves a session out of Inbox on its own.
11. Done sets the server's archived flag without changing the title, and returns
    to the start view, or opens the next Inbox session when Monitor Inbox is
    active. An empty, non-archived draft offers **Delete empty draft** instead;
    it removes the session immediately. Done is hidden while the agent is
    running and on snoozed sessions.
12. Reopening clears the archived flag and any snooze metadata, and does not
    rename the session. Reopen is available while the composer is idle and the
    session is archived or snoozed.
13. A session without projected messages and without a pending draft shows a
    dedicated New message view instead of the chat. The composer stays pinned
    below it with that session's tab. A new session focuses that tab immediately.
14. Each section header shows its session count whether the section is expanded
    or collapsed. Sections collapse independently; the toggle beside the search
    box opens or closes all of them at once, and both actions are remembered in
    local storage. Search temporarily forces every section open without
    overwriting the saved state.
15. Deleting one session or a shift-click range requires an explicit
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
16. Monitor Inbox targets the newest Inbox session for the current project by
    update time, independent of the sidebar search. It moves the open view when
    the toggle is turned on, after Done, Send, Build, or saving a draft, or when
    a session newly enters the Inbox while the start view is open. The first
    actions open the next newest Inbox session, or the start view when none
    remain. Sessions already in the Inbox when the start view opens never
    redirect, so manual navigation and the switch stay usable. The preference is
    remembered in local storage. The switch also shows the current Outbox count
    as “N agents working” (or “No agents working”) for the project.
17. Snoozed sessions leave Inbox, Outbox, and Drafts until they are reopened or
    engaged. Sending a reply, starting work, requesting a plan, running a
    command, saving a draft, or answering a permission or question clears the
    snooze marker first, so the session returns to whichever section its state
    implies. Archived wins when a session is both archived and snoozed. Snoozed
    sessions do not trigger desktop notifications, inbox sounds, or Monitor
    Inbox.
18. The interface calls a session a **Brief** by default. Settings → Session
    wording replaces that noun in every user-facing label, placeholder, toast,
    and notification. The setting offers Brief, Task, Session, Action, Run, and
    Job presets or any custom singular word, derives the plural, and stores the
    choice in the browser. The harness API and Clara's internal code still use
    `session`.
19. Project recency comes from Clara's `last_active_at`, which follows the
    newest session update seen for the project, on any harness; the switcher
    takes the newest seven and pins the current project when it falls outside
    them. The All projects page lists every non-archived project, or archived
    projects too when the filter asks for them. Projects with zero total sessions
    are hidden from both views by default; the header filter reveals them and
    saves the choice on the device. The current project stays pinned in the
    switcher even when it is empty. Project names, icons, and startup scripts are
    stored in Clara and shared by every connected client. Session counts combine
    every harness and split on `time.archived`; the statistics request is capped
    and the total shows `+` when it reaches the cap. A project whose linked
    harness is offline keeps its partial counts and stays visible with a partial
    marker; **Counts unavailable** appears only when the whole lookup fails.
20. Project archive, restore, delete, and remove are container actions. Archive
    sets the Clara flag and signals every linked harness; restore clears it and
    signals unarchive. Delete signals every linked harness and then removes the
    Clara container. Remove from Clara deletes only the container and workspace
    links. The harness result list is reported per harness; an offline or
    unsupported harness never blocks the Clara change.
21. Project settings are Clara metadata. Clara stores a custom icon override as
    a 128×128 PNG data URL, one of six avatar colors, and the workspace startup
    command. It merges the harness-discovered favicon from the workspace
    snapshot, and removing a custom image reveals the selected color or that
    favicon. Every project avatar in the sidebar, All projects cards, and project
    page follows that order.
22. The harness runs `commands.start` after it creates a new worktree. Clara does
    not create worktrees, so New brief does not run the startup script; the
    setting is for harness clients and future workspace support.
23. A harness can archive its own project record when a directory is missing.
    Clara ignores that archive state for visibility; only an explicit Clara
    archive hides a project. Reconciling a workspace through the harness
    location can unarchive the harness record, but it never removes the Clara
    container.
24. Mailbox lookups run within a shared request budget instead of launching
    three requests per session at once. A failed background refresh keeps the
    last list visible with a compact refresh notice; the full retry state appears
    only when no list is cached.
25. New brief picks a workspace in this order: the workspace last used for this
    project, the project's default workspace when it is online, the first online
    workspace, then the first linked workspace. The last-used workspace wins even
    when its harness is offline, so the choice never silently moves to another
    machine; a project with several workspaces still offers the others in the
    menu. The choice is remembered for the project on the device, so the next
    brief starts where the last one ran. A workspace can start work only when it
    is linked and its harness is online. A row shows the workspace label when
    set, otherwise the harness label; when two harnesses share a label, the menu
    appends a short harness id so the rows stay distinguishable.

## Edge cases

- **No projects** — an empty state offers **New project**; a project can be
  created before any workspace exists.
- **No workspaces** — New session is disabled on the home view and the project
  page invites the person to add a directory on a paired harness.
- **Workspace harness is offline** — adding a workspace still succeeds with an
  unresolved link; syncing later fills in the canonical path and harness project
  records.
- **The last-used workspace is offline** — New brief stays pointed at that
  workspace and is disabled until the harness reconnects; when the project has
  several workspaces, the menu shows the offline row disabled beside the online
  ones.
- **Every workspace is offline** — New brief is disabled and the start view names
  the offline harness and points at the workspace menu, so the person can
  reconnect rather than wonder where work went.
- **The selected workspace has no saved model** — New brief sends no model, so
  the harness picks its own default; a model from the project's other
  workspaces is not reused.
- **Workspace directory is missing** — the Clara project stays visible; the
  workspace remains unresolved and session lookup reports the harness problem.
- **A harness archives its own project** — Clara ignores it; only **Archive
  project** hides the Clara container.
- **Selected project outside the recent seven** — the switcher keeps it visible
  by replacing the seventh recent entry.
- **Project rename fails** — the dialog reports the error and the old name stays
  in place.
- **Project renamed on another client** — the mutation invalidates the project
  list for that client; the next refresh shows the new name.
- **Project icon image cannot be read or is too large** — the settings card
  reports the problem and keeps the previous icon.
- **Project icon save fails** — the preview returns to the stored icon and a
  toast reports the failure.
- **Project has a color and a discovered favicon** — the color avatar wins in
  Clara, matching the harness; choosing **Default** reveals the favicon again.
- **Custom project icon removed** — only the Clara icon override is cleared; the
  discovered favicon and selected color stay available.
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
- **Project statistics fail** — the card keeps its workspaces and actions and
  shows that counts are unavailable.
- **One linked harness is offline** — the card keeps the counts from the others, stays
  visible, and marks them as partial with a note naming the harness.
- **All linked harnesses fail** — only then does the card say counts are
  unavailable, and the project stays visible with its workspaces and actions.
- **Project archive or delete fails on one harness** — the Clara action still
  applies and the toast reports how many harnesses could not comply.
- **A harness does not support project archive/delete** — the result says
  unsupported; the Clara change still applies, and **Remove from Clara** remains
  available for a local-only removal.
- **Deleting a project that has no harness links** — Clara deletes the container
  without sending a harness signal.
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
- **One harness is offline during a project list** — the rows from the other
  harnesses still load and the offline harness is named in the per-harness status;
  the list does not fall back to an error state.
- **No linked harness answers** — the list reports the harness error with a retry
  instead of showing the project as empty.
- **Project has no record on any paired harness** — the session list reports
  `project_unmapped` with a retry, not an empty project.
- **Two workspaces share a harness label** — the New brief menu appends a short
  harness id to each row so the workspace on each machine stays distinguishable.
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
- **Leave an empty draft** — leaving an untitled brief with no user or assistant
  message, no saved draft, no composer text or attachments, and no waiting
  request deletes it. Its composer tab is removed and the composer follows the
  view that replaced it. Titled, running, worker, archived, and snoozed briefs
  are kept. Old untitled empty briefs are also swept from the session list when
  the chat view is closed; selection and idle notes do not keep them.
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
- **New session** — creates the session and focuses its composer tab so the
  first prompt can be typed immediately. The composer follows the new session;
  plain session navigation also selects the session's tab.
- **Messages fail to load** — the chat reports the failure and hides Done so a
  real session is not mistaken for an empty one.

## Out of scope

- Bulk actions other than project archive/delete and the sidebar's shift-click
  range deletion
- Clara-hosted project images, arbitrary avatar colors, or running the workspace
  startup script from Clara
- Creating, switching, or removing worktrees, or moving sessions between
  projects
- Moving a session from one harness to another, or switching which harness is
  active from the session list
- Sharing, export, or import
- Organizing sessions into folders or tags

## Known gaps

- The 50-session cap is not discoverable; older sessions can only be found by
  search.
- The workspace startup script set on the project page is not run by Clara's
  New brief action because Clara does not create worktrees.
- The active and archived lists each cap at 50 sessions.
- Settings model and agent catalogs show every paired harness; the composer
  uses the open session or target workspace harness.
- Session cards do not show a message count; that lives in the chat info panel.
- Saved drafts cannot be edited or cancelled from Clara yet; start the draft or
  delete the session.

## Technical appendix

<details>
<summary>Routes, data, and references</summary>

- Routes: `/`, `/projects`, `/p/:projectId`, `/p/:projectId/s/:sessionId`
- Projects: `client.project.list()` returns Clara containers sorted by
  `last_active_at`; the switcher takes seven and pins the current project when
  needed. `client.project.create({ name })` creates a container without a
  directory. `client.project.workspace.add({ harnessID, directory, label? })`
  links a directory and calls the harness location to resolve it.
- Project workspace sync: `client.project.sync({ projectID })` resolves every
  unresolved workspace, links matching harness project records, and stores the
  harness snapshot used for VCS, favicon, and sandbox display.
- Project archive/delete: `client.project.archive`, `unarchive`, and
  `remove({ mode })` return per-harness results. `mode: 'disconnect'` removes only
  Clara state.
- Project update: `client.project.update({ projectID, name?, icon?, commands?,
startupScript?, defaultWorkspaceID? })`.
- Project icon: the Clara override holds a custom image as a 128×128 PNG data
  URL; `icon.url` comes from the workspace snapshot; `icon.color` is one of
  `pink`, `mint`, `orange`, `purple`, `cyan`, or `lime`
- Icon upload: `apps/web/src/features/projects/project-icon.ts` resizes,
  center-crops, rejects inputs over 5 MB or results over 256 KB, and re-encodes
  as PNG
- Workspace startup script: `commands.start`, capped at 4,096 characters in the
  settings input; the harness runs it after creating a new worktree
- Project statistics: `client.session.list({ project: projectID, limit: 1000 })`
  counted by `time.archived`; the total shows `+` at the cap. `harnesses[]` marks
  the counts partial, and `describePartialHarnesses` names the missing harness
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
  includes snoozed sessions and sessions in worktrees or sandboxes, and returns
  `harnesses[]` per-harness status when the project spans more than one harness or
  a harness fails
- Workspace choice: `resolveProjectWorkspaceTarget` and `workspaceHarnessLabels` in
  `src/features/projects/project-workspaces.ts`; `projectSessionWorkspaces` keeps
  linked workspaces, `isWorkspaceStartable` requires `linked && online`
- Last workspace: `clara:last-workspace:<projectID>` in `localStorage`, written when
  a session starts
- Archived list: `client.session.list({ project: projectID, search, archived: true, limit: 50 })`
- Mailbox signals: `client.message.list({ sessionID, order: 'desc', limit: 1, type })`
  for `user` and `assistant`, plus `client.session.form.list({ sessionID })`
- Orchestration metadata: `session.metadata.automation === true` is preserved by
  the hub and adapters for the dedicated engine surface, but this client
  does not group or hide those sessions.
- Pending drafts: `client.session.inbox.list({ sessionID })`
- Save draft: `client.session.prompt({ sessionID, text, files, resume: false })`
- Start draft: `client.session.synthetic({ sessionID, text, description,
metadata, delivery: 'steer' })`
- Running state: `client.session.active()`, refreshed on `session.execution.*`,
  `session.status`, and `session.idle` events
- Awaiting input: `client.permission.request.list({ location: { directory } })`
  and pending forms
- Create: `client.session.create({ location: { directory }, harnessID, agent, model })`
  with `agent` resolved from `clara.defaultAgent` and `clara.lastAgent` in
  `localStorage`; `harnessID` is optional and resolved from the directory when
  omitted
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
- Leave an empty draft: `useDiscardEmptyDraft` in
  `src/features/chat/use-discard-empty-draft.ts` waits briefly, rechecks the
  composer and `clara.draft.<sessionID>`, confirms through
  `client.message.list({ sessionID, order: 'desc', limit: 1, type: 'user' })`,
  the same call with `type: 'assistant'`, and
  `client.session.inbox.list({ sessionID })`, then removes the session and
  closes its composer tab
- Session-list sweep: `usePruneEmptyDrafts` in
  `src/features/chat/use-prune-empty-drafts.ts` runs from the sidebar only
  outside the chat view. It uses the mailbox signals, skips running or
  form-bearing briefs and ones with a local draft, applies a 60-second grace
  period, and re-confirms each candidate with the same harness calls before
  removing it
- Local composer draft: `clara.draft.<sessionID>` in `localStorage`
- Composer tabs: `clara.composerTabs` in `localStorage`, validated and pruned by
  `src/features/chat/composer-tabs.ts`
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
