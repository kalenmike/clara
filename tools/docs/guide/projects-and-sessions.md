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
a directory and an optional label, or import an existing harness project. The
same project can hold workspaces on several harnesses, of any kind, on different
machines. Labels are what menus and project rows show, so name a workspace when
its folder name would not say which machine it is on. If a harness is offline,
Clara still saves the workspace and links it when the harness reconnects. Use
**Sync** after a directory moves or a harness comes online again.

## Find a project

The project button in the sidebar opens the seven most recently active projects.
Each row shows the project name and its first workspace; when the project spans
harnesses, the row adds that workspace's harness so two machines stay
distinguishable. Projects without sessions are hidden by default.

Choose **All projects** at the end of the menu to see every non-empty project.
The filter icon in the header reveals empty and archived projects. A project card
shows its workspace summary, last activity, and active and archived session
counts.

The harness can keep more than one project record for the same directory, for
example before and after `git init`. Clara combines the sessions from every
linked record, so the project shows all of its work. A project that spans
harnesses keeps showing the sessions it can read: counts from an offline harness
are left out and marked partial, and the card names the harness that is missing.
**Counts unavailable** means no linked harness answered. If the session list
cannot be loaded at all, Clara shows the error and a **Retry** action instead of
an empty project.

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
The toggle beside it opens or closes all sections.

## Start a session

1. Choose **New session**. When the project has more than one workspace, a menu
   lists them across every harness; offline workspaces are shown disabled.
   Otherwise Clara starts in the workspace the project last used. Either way it
   opens the composer.
2. Type a prompt and send it. The session moves to Outbox while the agent works.
3. When the reply arrives, the session moves to Inbox if it needs review.
4. Use **Reply** to continue, or **Done** to archive it.

Clara remembers the workspace you chose for each project, so the next session
starts in the same place. That remembered workspace wins even when its harness is
offline: Clara keeps the choice rather than moving work to another machine, and
**New session** stays disabled until the harness reconnects unless the project has
another workspace you can pick from the menu. When no workspace is online, the
start view names the harness to reconnect. Set the project's default workspace on
the project page.

A new session inherits the model of the most recent working session in the
workspace you start it in. If that workspace has no earlier session, Clara
starts on the harness default rather than borrowing another workspace's model.
It follows your **Default agent** setting. Hidden models are not inherited.

If you leave a new session before sending or saving anything, Clara removes it
so it does not pile up under **Drafts**. Notes about an agent or model change
do not count as content; typed text, attachments, and saved drafts keep the
session. Old empty sessions are also cleaned up when you return to the start or
project view.

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

To delete one session, use the header menu and confirm the dialog. To delete
several, select rows with Shift-click or Shift+Enter, then press Delete or
Backspace. A confirmation lists the count. Partial failures keep the failed rows
selected.

## Monitor the Inbox

**Monitor Inbox** on the start view jumps to the newest Inbox session. While it
is on, Clara advances after Done, Send, Build, or saving a draft. It also opens a
session that newly enters the Inbox while the start view is open.

The switch reports how many agents are working in the project's Outbox.

## See agent activity

Choose the activity icon beside Settings in the sidebar to open **Activity**. It
shows every session in the Inbox or Outbox for the project currently shown in
the sidebar, across all of that project's workspaces and harnesses. Archived and
snoozed sessions stay hidden.

Each card shows whether the session is in the Inbox or Outbox, plus its project,
harness, agent, model, token total, reported spend, and current plan. Plans load
for the most recently active sessions; other cards say **Plan not loaded** and
still open normally. Cards keep their position while you watch, and new sessions
appear at the end of their harness section. Harness sections keep offline or
partially unavailable harnesses visible when they belong to the project. The
page refreshes every ten seconds. Choose **Refresh** to update plans and session
state immediately.

You can open a session from any card, whichever harness in the project runs it.

## Related

- [Chat and approvals](chat.md)
- [The reply composer](composer.md)
- [Notifications](notifications.md)
