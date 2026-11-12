---
title: The reply composer
description: Send prompts, commands, mentions, attachments, and queued messages.
sidebar_position: 6
---

# The reply composer

The composer is a Gmail-style window docked to the bottom right of a chat. It
opens from **Reply**, **New**, or when a new session is created.

## Write and send

- Enter sends.
- Shift+Enter adds a line.
- On a touch device, Enter adds a line; tap Send.
- The window stays open while you scroll the thread behind it.

The composer remembers its size. **Expanded** is the default; the smaller dock is
restored the next time it opens if you chose it before.

## Keep the draft

Unsent text is stored per session in local storage, so switching sessions or
reloading does not lose it. Attachments stay with the open window and are not
kept across a reload.

## Commands and mentions

- Type `/` to open the command palette. Commands run when you send.
- Type `@` to mention a file, agent, skill, or reference. Mentions insert a path
  reference; they do not upload the file contents.

## Attach files

Use the paperclip, paste an image, or paste files from the clipboard. Attachments
appear as removable chips.

## Choose the model and agent

The **To** row sets the model and variant for the session. The footer sets the
active agent. Both change the session immediately.

Models hidden in **Settings → Models** do not appear, and the variant menu is
hidden when the model has no variants.

## Save, queue, or steer

The send button's chevron menu changes with the run:

- **Save as draft** before the first reply stores the prompt without starting.
- **Send as queued** while the agent works waits for the current run to settle.
- **Steer** is the normal send while a run is active.

## Answer requests in the composer

The **Reply** and **New** buttons show a badge when a question form or a finished
plan is waiting. Opening the composer stacks those cards above the editor.

- A question card can be answered alone, with a message, or skipped.
- A plan-ready card offers **Start** when the editor is empty. A typed message
  becomes an adjustment to the plan.

## Work across sessions

While the window is open or minimized it stays connected to the session it was
opened for. The title bar says which session it is for. Opening another session
does not move the draft; use the return control to jump back, or close the window
to rebind it to the session on screen.

## Related

- [Chat and approvals](chat.md)
- [Models and usage](models-and-usage.md)
- [Shortcuts](shortcuts.md)
