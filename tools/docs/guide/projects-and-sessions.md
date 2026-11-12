---
title: Projects and sessions
description: Find projects, work the mailbox, and manage sessions.
sidebar_position: 4
---

# Projects and sessions

A Clara project is a container for your work. It is not a directory. Each
workspace inside a project links it to a directory on one paired harness, so one
project can group several harnesses or several folders. A session is one
conversation in a workspace. Clara calls sessions **Briefs** by default; the noun
is yours to change.

## Create a project

Choose **New project** in the sidebar project menu or on the All projects page.
Give it a name; it starts with no workspaces.

Open the project and choose **Add workspace**. Pick a paired harness, then enter
a directory or import an existing harness project. If the harness is offline,
Clara still saves the workspace and links it when the harness reconnects. Use
**Sync** after a directory moves or a harness comes online again.

## Find a project

The project button in the sidebar opens the seven most recently active projects.
Each row shows the project name and its first workspace. Projects without
sessions are hidden by default.

Choose **All projects** at the end of the menu to see every non-empty project.
The filter icon in the header reveals empty and archived projects. A project card
shows its workspace summary, last activity, and active and archived session
counts.

The harness can keep more than one project record for the same directory, for
example before and after `git init`. Clara combines the sessions from every
linked record, so the project shows all of its work. If the session list cannot
be loaded, Clara shows the error and a **Retry** action instead of an empty
project; project counts that could not be checked are marked unavailable.

## Archive, delete, or remove

The project menu offers three different actions:

- **Archive project** hides the project and asks every linked harness to archive
  its project data. Restore reverses that.
- **Delete project** deletes the Clara project and asks every linked harness to
  delete its project data. With the included OpenCode adapter, this permanently
  deletes every session in the linked project records; the harness project
  record may remain.
- **Remove from Clara** deletes only the Clara project and its workspace links.
  Harness projects and sessions stay untouched.

Clara always applies its own change and reports any harness that was offline or
does not support the action. Removing a workspace from the project page only
unlinks it from Clara.

## Work the mailbox

Sessions are grouped into five collapsible sections:

- **Inbox** — needs you.
- **Outbox** — the agent is working or still owes a reply.
- **Drafts** — empty sessions or saved first prompts.
- **Snoozed** — postponed.
- **Archived** — finished.

The search box filters by title and expands every section while it is active.
The toggle beside it opens or closes all sections. Worker sessions appear in a
separate **Workers** drawer when orchestration is running.

## Start a session

1. Choose **New session**. Clara creates the session in the default workspace,
   or asks which workspace when the project has several. It opens the composer.
2. Type a prompt and send it. The session moves to Outbox while the agent works.
3. When the reply arrives, the session moves to Inbox if it needs review.
4. Use **Reply** to continue, or **Done** to archive it.

A new session inherits the model of the most recent working session in the
project. It follows your **Default agent** setting. Hidden models are not
inherited. Set the default workspace from the project page.

## Save a first prompt as a draft

Before the first agent reply, the send button's menu offers **Save as draft**.
Clara stores the prompt, renames an untitled session from its opening words, and
leaves it in Drafts with a **Start** card. Start delivers the draft and begins
the run.

## Snooze, archive, and reopen

- The session header's more menu can **Snooze session**.
- **Done** archives the session without renaming it.
- **Reopen** appears on an archived or snoozed session and clears that state.
- Replying, starting work, saving a draft, or answering a question clears a
  snooze automatically.

## Rename or delete

The session header can rename the session. Renaming changes only the Clara title;
the harness session underneath is unchanged.

To delete one session, use the header menu. To delete several, select rows with
Shift-click or Shift+Enter, then press Delete or Backspace. A confirmation lists
the count. Partial failures keep the failed rows selected.

## Monitor the Inbox

**Monitor Inbox** on the start view jumps to the newest Inbox session. While it
is on, Clara advances after Done, Send, Build, or saving a draft. It also opens a
session that newly enters the Inbox while the start view is open.

The switch reports how many agents are working in the project's Outbox.

## See every running agent

Choose the activity icon beside Settings in the sidebar to open **Running
agents**. It shows every session where an agent is working across all paired
harnesses, not just the active one.

Each card shows the project, harness, agent, model, token total, reported spend,
and the agent's current plan. Harness sections keep offline or partially
unavailable harnesses visible. The page refreshes every ten seconds. Choose
**Refresh** to update plans immediately.

You can open a session from the card while its harness is the active one. Other
harnesses are shown read-only.

## Related

- [Chat and approvals](chat.md)
- [The reply composer](composer.md)
- [Notifications](notifications.md)
