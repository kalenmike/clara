# Sessions

## Summary

The project and session browser is how people find their work. Projects group
sessions by the directory OpenCode opened; sessions are the units of conversation
that Clara opens in the chat view.

## User flow

1. After connecting, Clara redirects to the last project or the first project.
2. The sidebar project button opens a menu of every project the server knows,
   showing its name and canonical path.
3. Choosing a project loads its sessions, grouped into Today, Yesterday, Previous
   7 days, and Older.
4. The search box filters sessions by title using the server's search parameter.
5. **New session** creates a session in the selected project and opens it.
6. On the project page, sessions also appear as cards with agent, model, token
   totals, cost, and update time.
7. Opening a session shows it in the sidebar and loads the chat view.
8. The chat header can rename, archive, or delete the current session.

## Core business rules

1. Sessions are fetched by the project's **directory**, not by project ID; the
   server's `project` filter does not return the expected rows in 2.1.1.
2. The list shows the newest 50 sessions for the directory, newest first.
3. A new session inherits the agent and model of the most recent session in the
   project, so the first prompt uses a model that already works.
4. Running sessions are marked with a live dot driven by the active-session map
   and status events.
5. Deleting a session requires confirmation and permanently removes its messages.

## Edge cases

- **No projects** — an empty state explains that a directory must be opened with
  OpenCode first.
- **No sessions** — the list invites the person to create one.
- **Search with no matches** — the list says so without clearing the query.
- **Project removed from the server** — the project page shows "Project not
  found" with a way home.
- **Session deleted elsewhere** — the chat route reports "Session not found" and
  offers the project page.
- **Session reports `projectID: "global"`** — links use the selected project ID,
  not the session field.
- **Session creation fails** — the button returns to its normal state and no
  navigation happens.
- **Very long titles** — rows and cards truncate or clamp; the full title is in
  the chat header.
- **Archived sessions** — hidden from the normal list.

## Out of scope

- Infinite scroll, cursor pagination UI, or bulk actions
- Workspaces, worktrees, or moving sessions between projects
- Sharing, export, or import
- Organizing sessions into folders or tags

## Known gaps

- The 50-session cap is not discoverable; older sessions can only be found by
  search.
- There is no dedicated archived-sessions view.
- Session cards do not show a message count; that lives in the chat info panel.

## Technical appendix

<details>
<summary>Routes, data, and references</summary>

- Routes: `/p/:projectId`, `/p/:projectId/s/:sessionId`
- List: `client.session.list({ directory, search, limit: 50 })`
- Create: `client.session.create({ location: { directory }, agent, model })`
- Update: `client.session.update({ sessionID, title?, archived? })`
- Delete: `client.session.remove({ sessionID })`
- Active map: `client.session.active()`
- Related: [capabilities](capabilities.md), [chat](chat.md)

</details>
