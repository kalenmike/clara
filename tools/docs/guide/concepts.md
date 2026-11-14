---
title: Understand the screen
description: The vocabulary Clara uses for hubs, projects, sessions, and agents.
sidebar_position: 2
---

# Understand the screen

Clara borrows a few words from the harness it connects to and adds a few of its
own. These are the ones you will see most often.

## The moving parts

| Term            | What it means                                                                                                                                |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| **Hub**         | The Clara installation on the machine that runs the hub service. It can be one process, one database, one panel, and at most one relay room. |
| **Hub service** | The process itself. It carries traffic between your devices and the harnesses they use over the encrypted WebSocket.                         |
| **Hub panel**   | The authenticated dashboard on the hub machine. The host uses it to add a harness and manage devices. You normally never open it.            |
| **Harness**     | The agent runtime Clara connects to. Several can be paired; the active one is the default when a screen does not name a harness.             |
| **Adapter**     | The small process on the harness machine that connects it to the hub. It holds the harness credentials.                                      |
| **Project**     | A container for your work. It holds workspaces, so one project can span harnesses and machines.                                              |
| **Workspace**   | A directory on one harness that a project can run work in. A project can have several workspaces.                                            |
| **Session**     | One conversation with an agent. The interface calls it a **Brief** by default.                                                               |
| **Agent**       | The LLM worker or agent definition that produces a reply. This never means the hub.                                                          |
| **Model**       | The LLM a session uses, with an optional variant.                                                                                            |
| **Relay**       | The Cloudflare service that lets a browser or adapter reach a hub that is not publicly reachable. It only forwards encrypted frames.         |
| **Device**      | A browser or installed app that has paired with the hub. Each device has its own revocable key.                                              |

A **project** is yours; a **workspace** is a directory on one harness. Add a
workspace for each folder a project should reach, and Clara keeps the work
together even when the folders live on different machines. The **active
harness** is only a default: it answers screens that do not name a session or
workspace, while anything opened from a workspace goes to that workspace's own
harness. You choose the active harness in the hub panel.

## The mailbox

The sidebar groups sessions by what they need from you.

| Section      | What is in it                                                                                                           |
| ------------ | ----------------------------------------------------------------------------------------------------------------------- |
| **Inbox**    | Sessions that need a person: a pending approval or question, a failed run, a finished plan, or an idle reply to review. |
| **Outbox**   | Sessions where the agent still owes a reply, including every running session.                                           |
| **Drafts**   | Empty sessions and first prompts saved without starting a run.                                                          |
| **Snoozed**  | Sessions you postponed.                                                                                                 |
| **Archived** | Sessions you finished or archived on the server.                                                                        |

A red pulsing dot means a run is blocked on an approval or question. A red dot
means the latest run failed. An orange dot marks a finished Plan waiting for
**Steer** or **Build**. A grey dot is an idle reply to review and close.

## The chat screen

- The header shows the session title, whether the run is busy or idle, the
  active agent, and the harness that owns the session.
- The thread renders prompts and replies as Markdown. Each message has a sender,
  a timestamp, and a fold control.
- **Internal output** is hidden by default. Turn it on to see reasoning, tool
  calls, commands, and system reminders.
- The composer docks to the bottom right. It carries the prompt, slash commands,
  mentions, attachments, and model and agent pickers.
- The right panel has Info, Git, Terminal, and a Plan dock. The Plan dock follows
  the agent's todo list.

## Plan and Build

Some agents work in two stages. A **Plan** run researches and writes a plan.
When it finishes, Clara offers a handoff: **Start** switches to the working agent
and begins, while typing a message sends an adjustment back to the planner. The
handoff appears as a card in the composer, not as something you typed.

## Automation

Messages created by Clara or orchestration are labelled **Automation** with a Zap
avatar. They are still part of the conversation, but they were not typed by a
person.

## Next steps

- [Projects and sessions](projects-and-sessions.md)
- [Chat and approvals](chat.md)
- [Security and privacy](security.md)
