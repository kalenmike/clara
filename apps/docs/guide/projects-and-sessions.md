---
title: Projects and sessions
description: Find projects, work the mailbox, and manage sessions.
sidebar_position: 4
---

# Projects and sessions

A project is a directory OpenCode has opened. A session is one conversation in
that project. Clara calls sessions **Briefs** by default; the noun is yours to
change.

## Find a project

The project button in the sidebar opens the seven most recently active projects.
Each row shows the project name and its directory. Projects without sessions are
hidden by default.

Choose **All projects** at the end of the menu to see every non-empty project.
The filter icon in the header reveals empty projects. A project card shows its
directory, last activity, and active and archived session counts.

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

1. Choose **New session**. Clara creates the session in the selected project and
   opens the composer.
2. Type a prompt and send it. The session moves to Outbox while the agent works.
3. When the reply arrives, the session moves to Inbox if it needs review.
4. Use **Reply** to continue, or **Done** to archive it.

A new session inherits the model of the most recent working session in the
project. It follows your **Default agent** setting. Hidden models are not
inherited.

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
the OpenCode session underneath is unchanged.

To delete one session, use the header menu. To delete several, select rows with
Shift-click or Shift+Enter, then press Delete or Backspace. A confirmation lists
the count. Partial failures keep the failed rows selected.

## Monitor the Inbox

**Monitor Inbox** on the start view jumps to the newest Inbox session. While it
is on, Clara advances after Done, Send, Build, or saving a draft. It also opens a
session that newly enters the Inbox while the start view is open.

The switch reports how many agents are working in the project's Outbox.

## Related

- [Chat and approvals](chat.md)
- [The reply composer](composer.md)
- [Notifications](notifications.md)
