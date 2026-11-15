---
title: Activity
description: Read the cross-workspace Inbox and Outbox view for the active project.
sidebar_position: 4
---

# Activity

## Summary

The Activity page shows the active project's Inbox and Outbox sessions across
every workspace and paired harness. It is a read-only overview for people who
run agents in more than one workspace or on more than one machine and want to
see waiting work and work in progress in one place.

## User flow

1. Choose **Activity** in the app header. The page follows the project opened
   last, or the first project when none has been used, and opens without the
   project sidebar.
2. Read the summary for active sessions, Inbox and Outbox counts, harnesses,
   tokens, and reported spend.
3. Read each harness section. Only harnesses with a workspace in the active
   project appear, in pairing order, with sessions oldest first.
4. Read a session card for its Inbox or Outbox badge, project, harness, agent,
   model, last update, token total, and reported spend.
5. Read the plan checklist in the card; the header shows completed items against
   the total.
6. Choose a session title to open it, on any harness in the project.
7. Leave the page open for a refresh every ten seconds, or press **Refresh** to
   reload immediately and bypass the activity caches.
8. Read the Other harnesses row for project harnesses with no Inbox or Outbox
   sessions, or ones that are offline or could not be checked.

## Core business rules

1. Only sessions whose Clara project is the active project appear. Sessions in
   other projects, and harnesses without a workspace in the active project, are
   not read.
2. A session appears while it is in the Inbox or Outbox on any harness in the
   project. Archived and snoozed sessions are hidden, and drafts are not part of
   either mailbox. [Sessions](index.md) defines both mailboxes once.
3. Cards keep their position. Sessions are ordered by creation time within each
   harness, and harness sections follow pairing time. A run finishing changes
   the card's badge instead of moving it; new sessions append to their harness.
4. Session totals and spend come from the session record the harness returns.
   Spend is the amount the harness reports, not a price estimate.
5. The plan is the newest completed `todowrite` call in the loaded assistant
   messages. An empty list means the agent cleared the plan, or that the newest
   plan was written before the loaded window.
6. The page is read-only. It cannot start, steer, interrupt, or delete a
   session, and it cannot switch the active project.
7. A project harness that is offline or fails its lookup is reported on the page
   without hiding results from other project harnesses. A session whose mailbox
   signals fail is still shown and marked as a partial harness failure.

## Edge cases

- **No project selected** — the page explains that a project must be opened from
  Chat first.
- **Project without workspaces** — the page explains that the project needs a
  workspace on a paired harness.
- **No harnesses available** — the page explains that a harness must be paired
  and added to the project.
- **No Inbox or Outbox sessions** — the page explains when sessions appear and
  that snoozed and archived sessions stay hidden.
- **Project harness offline** — its sessions cannot be read, so it appears as
  offline.
- **Partial harness failure** — loaded sessions still appear; the harness is
  marked Partial with a count of sessions that could not be classified.
- **Transcript unavailable** — the session still appears, and its plan says
  Plan unavailable.
- **No plan** — the card says No plan yet; outside the plan budget it says Plan
  not loaded.
- **Snooze or archive on any project harness** — the query refreshes shortly
  after the session event, so the card disappears before the next poll.
- **Refresh fails** — the page keeps the last successful result.

## Out of scope

- Starting, steering, interrupting, or deleting sessions from this page
- Switching the active project or choosing a default harness here
- Showing drafts, snoozed sessions, or archived sessions
- Estimated or historical spend, usage charts, file activity, or a waterfall
  timeline

## Known gaps

- The hub reads up to 1,000 non-archived sessions per project harness; older
  Inbox or Outbox sessions beyond that bound are not shown.
- Plans load for Outbox sessions first and then the 50 most recently updated
  sessions per harness; older cards show Plan not loaded, and a plan written
  before the newest 50 assistant messages is not shown.
- Running plans can be up to five seconds stale and idle plans up to five
  minutes stale during polling. **Refresh** bypasses both caches.

## Technical appendix

<details>
<summary>Routes, data, and references</summary>

- Endpoint: `GET /v1/activity/sessions?project=<claraproj>`; omitting `project`
  keeps the legacy unscoped fan-out for older clients. The deprecated alias
  `GET /v1/activity/running` returns only running sessions.
- Response: `ClaraActivitySessionsResponse` in `@clara/api-contract`.
- Mailbox rules: `resolveSessionMailbox` in `@clara/shared-types`.
- Page: `apps/web/src/pages/activity-page.tsx`; cards under
  `apps/web/src/components/activity/`; hook `use-activity-sessions.ts`.
- Hub fan-out: `apps/hub/server/src/activity/sessions.ts`; plan parsing
  `findPlanTodos` in `@clara/api-contract`.
- The hub resolves the project's workspaces, asks only those harnesses for
  active sessions, pending permissions, and every page of non-archived
  sessions, overlays Clara metadata, then keeps the requested project. Plans and
  signals are cached per harness and session; `?refresh=true` bypasses both.
- Related: [sessions](index.md), [session panel](../session-panel.md),
  [chat](../chat/index.md).

</details>
