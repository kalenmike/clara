---
title: Projects and workspaces
description: Manage Clara projects, their workspaces, and project settings.
sidebar_position: 3
---

# Projects and workspaces

## Summary

A Clara project is the container the sidebar and session list work in. People
create projects, link one or more workspaces on paired harnesses, and manage the
project's name, icon, color, and startup script from Clara. The switcher keeps
recent projects close, and the All projects page and project page carry the
management actions.

Clara projects are containers, not directories: each workspace links one
`(harness, directory)` pair, and a project can span any number of paired
harnesses on different machines. [Project and directory
scoping](../../architecture/overview.md#project-and-directory-scoping) owns the
scoping rules.

## User flow

1. The sidebar switcher lists the seven most recently active projects and ends
   with **New project** and **All projects**.
2. **New project** creates an empty container that can exist before any
   workspace; **All projects** shows one card per non-empty project with its
   workspace summary, last activity, and active and archived session counts.
3. A filter icon at the far right of the All projects header reveals **Show empty
   projects** and **Show archived projects**, both off by default.
4. The card menu renames the project, adds a workspace, or archives, restores,
   deletes, or removes it.
5. The project page shows an info card with the container ID, workspaces, default
   workspace, timestamps, and session counts.
6. Each workspace row has actions to set the default, sync, or remove it from
   Clara.
7. A settings card below edits the project icon, avatar color, and workspace
   startup script.
8. A sessions heading lists the project's session cards with agent, model, token
   totals, cost, and update time.

## Core business rules

1. Project recency comes from Clara's `last_active_at`, which follows the newest
   session update seen for the project on any harness. The switcher takes the
   newest seven and pins the current project when it falls outside them, even
   when it is empty.
2. Projects with zero total sessions are hidden from the switcher and All
   projects by default. The header filter reveals empty and archived projects and
   saves the choice on the device. The All projects page lists every non-archived
   project unless the archive filter asks for more.
3. Project names, icons, and startup scripts are stored in Clara and shared by
   every connected client. A project created in Clara can exist before any
   workspace, and harness project lists never create Clara projects.
4. A workspace can be added while its harness is offline. Clara stores the
   directory, shows it as unresolved, and links it through the harness location
   on the next sync. Sync also stores the harness snapshot used for VCS, favicon,
   and sandbox display.
5. Workspace rows show the harness, directory, online state, and link state. A
   workspace can start a session only when it is linked and its harness is
   online; removing a workspace deletes only its Clara link.
6. Archive, restore, delete, and remove are container actions. Archive and delete
   signal every linked harness and report the result per harness; an offline or
   unsupported harness never blocks the Clara-side change. **Remove from Clara**
   deletes only the container and its workspace links, leaving harness data
   untouched.
7. Project settings are Clara metadata. The custom icon is a 128×128 PNG data
   URL, the avatar uses one of six colors, and the startup command is stored in
   Clara. Clara merges the harness-discovered favicon from the workspace
   snapshot: a custom image wins, then the selected color, then the favicon.
8. Session counts combine every harness and split on the archived timestamp. The
   statistics request is capped and shows `+` at the cap. A project with an
   offline harness keeps partial counts and stays visible with a partial marker;
   **Counts unavailable** appears only when the whole lookup fails.
9. The harness runs the workspace startup script after it creates a new worktree.
   Clara does not create worktrees, so New session does not run it.

## Edge cases

- **No workspaces** — New session is disabled and the project page invites the
  person to add a directory on a paired harness.
- **Workspace harness is offline** — adding still succeeds with an unresolved
  link; a later sync fills in the canonical path and harness records.
- **Harness archives its own project** — Clara ignores it; only **Archive
  project** hides the container.
- **Rename fails** — the dialog reports the error and the old name stays.
- **Icon cannot be read or is too large** — the card reports the problem and
  keeps the previous icon; a failed save restores the stored icon.
- **Color and discovered favicon** — the color avatar wins in Clara; choosing
  **Default** reveals the favicon again.
- **Startup script save fails** — the input keeps the text and a toast reports
  the failure.
- **Project metadata changes on another client** — the `project.updated` event
  refreshes the page and every avatar.
- **Every project is empty** — All projects shows a filter-aware empty state with
  a **Show empty projects** action.
- **Project removed from the server** — the project page shows "Project not
  found" with a way home.

## Out of scope

- Clara-hosted project images beyond the icon override, or arbitrary avatar
  colors
- Running the workspace startup script from Clara
- Creating, switching, or removing worktrees
- Moving sessions between projects

## Known gaps

- The workspace startup script set on the project page is not run by New session
  because Clara does not create worktrees.

## Technical appendix

<details>
<summary>Routes, data, and references</summary>

- Routes: see the [routing table](../../architecture/overview.md#routing).
- Projects: `client.project.list()` returns Clara containers sorted by
  `last_active_at`; `client.project.create({ name })` creates one without a
  directory.
- Workspaces: `client.project.workspace.add({ harnessID, directory, label? })`
  and `client.project.sync({ projectID })`.
- Project actions: `client.project.archive`, `unarchive`, and
  `remove({ mode })` return per-harness results; `mode: 'disconnect'` removes
  only Clara state.
- Update: `client.project.update({ projectID, name?, icon?, commands?, startupScript?, defaultWorkspaceID? })`.
- Icon: 128×128 PNG data URL, inputs over 5 MB or results over 256 KB rejected,
  colors `pink`, `mint`, `orange`, `purple`, `cyan`, and `lime`; startup command
  capped at 4,096 characters.
- Statistics: `client.session.list({ project, limit: 1000 })` counted by
  `time.archived`; `harnesses[]` marks partial counts.
- Page: `PageShell` with `ProjectInfoCard` and `ProjectSettingsCard`.
- Empty project filter: `clara.showEmptyProjects` in local storage.
- Related: [sessions](index.md), [activity](activity.md),
  [connection](../connection.md).

</details>
