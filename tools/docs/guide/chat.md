---
title: Chat and approvals
description: Read replies, follow tool work, answer approvals, and steer a run.
sidebar_position: 5
---

# Chat and approvals

The chat view streams the conversation and pauses when the agent needs a
decision. You can read at your own pace; a running session keeps filling in.

## Read the thread

Each message is full width with a sender, timestamp, and fold control. Prompts
and replies render as Markdown, and single line breaks in prompts are preserved.
Older messages start collapsed so the newest reply is visible. A chat opens at
its newest output, and stays where you leave it while you read.

The header shows the session title, busy or idle state, the active agent, and the
harness that owns the session.
The arrows at the left edge step through messages; double-press to jump to the
newest output or the top of the loaded history.

## Show internal work

Internal output is hidden by default. Use the eye control in the thread header to
show reasoning, tool calls, shell commands, and system reminders. Tool cards
expand to show input, output, duration, and status.

Token and cost totals from hidden steps roll into the next visible reply, so
turning internal output off does not lose usage.

## Answer an approval

When a tool needs permission, a panel appears above the thread with:

- **Allow once**
- **Always allow**
- **Reject**

The card header folds the panel while the request stays pending. **Agent's
thinking** expands the reasoning that led to the request.

## Answer a question

Agent questions appear as cards in the composer. Select the card, fill the
fields, and send. You can answer alone, add a message, or send a message and let
the form be answered with it. **Skip** cancels the selected form.

Answers appear in the thread as a compact system row, not as a message you
typed.

## Steer, queue, or save

While a run is active:

- **Send** steers the current run.
- The send menu's **Send as queued** waits for the active run to settle.
- Before the first reply, **Save as draft** stores the prompt without starting.

## Stop a run

Use **Stop** or press Escape. Escape first closes an open menu or dialog, then
cancels a part selection, and only then interrupts the run.

## Finish or continue

- Type in the composer to continue the session.
- The send menu's **Done** archives the session and returns to the start view.
- **Reopen** in the send menu clears an archive or snooze.
- **Snooze** moves the session to the Snoozed section.

## Plan handoff

When a Plan run finishes, the send button's chevron menu offers **Start work**.
With an empty editor, Start work switches to the working agent and begins. With
a message in the editor, Start work sends that message to the working agent as
the first prompt; Send instead delivers it to the planner as an adjustment. Start
work is hidden while a question is waiting.

## Fork and forward

The session header can fork the whole session. Each user or assistant message
has fork and forward actions in a vertical rail at its right edge. On a long
message the rail stays pinned below the header until the message ends, so you
never have to scroll back up to reach it. On a phone, the same actions live in
the message's overflow menu. **Select part** on a long reply lets you pick one
paragraph, list, code block, table, quote, or heading section before forwarding.

## Usage

The bar along the bottom of the pane shows the whole session's input, output,
reasoning, and cache tokens, its cost, and how long ago the session started. See
[Models and usage](models-and-usage.md) for the cost display modes.

## Related

- [The reply composer](composer.md)
- [Projects and sessions](projects-and-sessions.md)
- [Notifications](notifications.md)
