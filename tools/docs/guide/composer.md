---
title: The composer
description: Send prompts, commands, mentions, attachments, and queued messages.
sidebar_position: 6
---

# The composer

The composer is the panel at the bottom of every chat. It is always open and
carries the draft, commands, mentions, attachments, and any question or plan
waiting for you.

## Write and send

- Enter sends.
- Shift+Enter adds a line.
- On a touch device, Enter adds a line; tap Send.

## Three shapes

The composer has three shapes, controlled from the right side of its header:

- **Pinned** is the default. It docks at the bottom of the thread, spans the
  chat, and the thread ends at its top edge, so it never covers a message.
- **Collapse** folds the composer to its header. The leading chevron points down
  while the composer is open; click it again, or use the upward chevron, to
  restore the shape it had before.
- **Expand** fills the screen. Expand again to return to the pinned dock. The
  expand control always goes fullscreen, so using it from a collapsed composer
  opens fullscreen directly.

Drag the pinned composer's top edge to make it taller or shorter. With the
resize handle focused, use Up/Down, Home/End, or double-click to reset the
height. The height is remembered; a reload starts pinned.

If you turn on **Auto-hide the composer** in **Settings → Preferences**, the
composer rests as its title bar. Point at the title bar to expand it, and move
away to collapse it. Typing or an open menu keeps it open until you finish. The
collapse chevron becomes a pin: pin the composer to keep it open, then unpin to
return to auto-hide. A maximized composer stays visible. Touch devices do not
show the setting or use it.

## Tabs

The header is a tab strip with one tab per session. The session you are viewing
has a highlighted tab and cannot be closed.

Every tab carries the same status mark as its sidebar row:

- A pulsing green dot means the agent is running.
- A pulsing red dot means it is waiting for an answer or an approval.
- A red dot means the last run failed.
- An orange dot means a finished plan is ready to review.
- A grey dot means the session is idle or waiting for you to review a finished
  reply.
- An alarm clock means the session is snoozed.

- Leave a session while its composer still has text or attachments, and its tab
  stays so you can come back to the draft.
- Select another tab to edit that draft without leaving the chat you are reading.
- The arrow on a tab opens that session.
- Close a tab to remove the shortcut. Its saved draft stays, so opening the
  session again restores the text.
- Tabs and their text drafts survive a reload. Attachments are kept for the visit
  only.

## Keep the draft

Unsent text is stored per session in local storage. Attachments stay with the
open tab and are not kept across a reload.

## Commands and mentions

- Type `/` to open the command palette. Commands run when you send.
- Type `@` to mention a file, agent, skill, or reference. Mentions insert a path
  reference; they do not upload the file contents. Only agents that can run the
  session appear here; model-invoked subagents do not.

## Attach files

Use the paperclip, paste an image, or paste files from the clipboard. Attachments
appear as removable chips.

## Choose the model and agent

The **To** row sets the model and variant for the session. The footer sets the
active agent. Both change the session immediately.

A harness with no selectable agents (Pi) hides the agent control. When a harness
offers only model-invoked subagents (Claude Code), the control lists them
read-only under **Subagents** instead of offering them as the main agent.

Models hidden in **Settings → Models** do not appear, and the variant menu is
hidden when the model has no variants.

## Save, queue, finish, or steer

The send button's chevron menu holds everything that is not the primary send:

- **Start work** when a plan is ready hands the plan to the working agent. A
  message in the editor becomes the first Build prompt.
- **Save as draft** before the first reply stores the prompt without starting.
- **Send as queued** while the agent works waits for the current run to settle.
- **Done** archives an idle session and returns to the start view.
- **Delete empty draft** removes an empty draft.
- **Reopen** brings an archived or snoozed session back.
- **Steer** is the normal send while a run is active.

## Answer requests in the composer

A session tab shows a badge when a question form or a finished plan is waiting.
Select the tab to see those question cards stacked above the editor.

- A question card can be answered alone, with a message, or skipped.
- A tall question form scrolls with the composer. Scroll down to reach the
  message box and type a custom message or a plan adjustment.
- A finished plan offers **Start work** in the send menu. A typed message
  becomes an adjustment when you press Send, or the first Build prompt when you
  choose Start work.

## Work across sessions

Each tab keeps its own draft. The composer follows the session you open, and a
tab you leave behind keeps its text and attachments until you send or clear it.
Selecting a tab only changes what the composer is editing; use the tab's arrow to
open that session in the chat.

## Related

- [Chat and approvals](chat.md)
- [Models and usage](models-and-usage.md)
- [Shortcuts](shortcuts.md)
