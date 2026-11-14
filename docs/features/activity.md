# Activity

## Summary

The Activity page shows every session in the Inbox or Outbox across all paired
harnesses. It is a read-only overview for people who run agents on more than one
harness and want to see both work in progress and sessions waiting for them.

## User flow

1. Choose the activity icon in the sidebar header.
2. Read the summary for active sessions, Inbox and Outbox counts, harnesses,
   tokens, and reported spend.
3. Read each harness section. Sections follow pairing order, and sessions keep
   their position from oldest to newest.
4. Read a session card for its Inbox or Outbox badge, project, harness, agent,
   model, last update, token total, and reported spend.
5. Read the plan checklist for that session. The header shows completed items
   against the total.
6. Choose a session title to open it, on any harness. A card whose project Clara
   does not know shows the harness project id and no link.
7. Leave the page open. It refreshes every ten seconds, or press **Refresh** to
   reload immediately and bypass the activity caches.
8. Read the Other harnesses row to see paired harnesses with no Inbox or Outbox
   sessions, or harnesses that are offline or could not be checked.

## Core business rules

1. A session appears while it is in the Inbox or Outbox on any paired harness.
   Archived and snoozed sessions are hidden, including sessions Clara marked
   itself; drafts are not part of either mailbox and stay hidden.
2. Inbox and Outbox follow the same rules as the session sidebar. Awaiting input
   or an assistant-last transcript is Inbox; a running agent or a user-last
   transcript is Outbox. Worker sessions are included in this view.
3. Cards keep their position. Sessions are ordered by creation time, oldest
   first, within each harness, and harness sections follow pairing time. A run
   finishing changes the card's badge instead of moving it; new sessions append
   to the end of their harness.
4. Session totals and spend come from the session record the harness returns.
   Spend is the amount the harness reports, not a price estimate.
5. The plan is the newest completed `todowrite` call in the loaded assistant
   messages. An empty list means the agent cleared the plan, or that the newest
   plan was written before the loaded window.
6. A harness that is offline or fails its lookup is reported on the page without
   hiding results from other harnesses. A session whose mailbox signals fail is
   still shown and counted as a partial harness failure.

## Edge cases

- **No harnesses paired** — the page explains that a harness must be paired
  first.
- **No Inbox or Outbox sessions** — the page explains that sessions appear while
  an agent is working or waiting for a reply, and that snoozed and archived
  sessions stay hidden.
- **Harness offline** — its sessions cannot be read, so it appears as offline.
- **Partial harness failure** — sessions that loaded still appear; the harness
  is marked Partial with a count of sessions that could not be classified.
- **Transcript unavailable** — the session still appears, and its plan says
  Plan unavailable.
- **No plan** — the card says No plan yet.
- **Session outside the plan budget** — the card says Plan not loaded. Opening
  the session shows the full plan dock.
- **Unknown project** — the card shows the harness project ID and does not offer
  a link.
- **Session on another harness** — the card behaves like any other: it opens the
  session when Clara knows its project, and shows no link when it does not.
- **Snooze or archive on any harness** — the activity query refreshes shortly
  after the session event, so the card disappears without waiting for the next
  poll.
- **Long checklist** — the plan area scrolls inside the card.
- **Page left open** — the query refreshes every ten seconds and shows the last
  successful result if a refresh fails.

## Out of scope

- Starting, steering, interrupting, or deleting sessions from this page.
- Choosing a default harness from this page; that remains a panel setting.
- Showing drafts, snoozed sessions, or archived sessions.
- Excluding worker sessions. A later orchestrator view will be able to hide
  them.
- Estimated spend across harnesses.
- Historical spend, usage charts, file activity, or a waterfall timeline.

## Known gaps

- The hub reads up to 1,000 non-archived sessions per harness as a safety bound.
  Older Inbox or Outbox sessions beyond that bound are not shown.
- Plans load for Outbox sessions first and then the 50 most recently updated
  sessions per harness. Older cards stay in place but show Plan not loaded.
- A plan written before the newest 50 assistant messages is not shown. The
  session's Plan dock still has the full checklist.
- Spend is always the amount each harness reports; Activity does not estimate
  cost from model prices.
- Running plans can be up to five seconds stale, and idle plans up to five
  minutes stale, during automatic polling. The Refresh button bypasses both
  caches.
- An offline harness reports changes on the next poll; the page refreshes every
  ten seconds regardless.

## Technical appendix

<details>
<summary>Routes, data, and references</summary>

- Endpoint: `GET /v1/activity/sessions`
- Deprecated alias: `GET /v1/activity/running` returns only running sessions for
  older cached clients.
- Response: `ClaraActivitySessionsResponse` in `@clara/api-contract`
- Mailbox rules: `resolveSessionMailbox` in `@clara/shared-types`
- Page: `apps/web/src/pages/activity-page.tsx`
- Cards: `apps/web/src/components/activity/`
- Hook: `apps/web/src/features/activity/use-activity-sessions.ts`
- Hub fan-out: `apps/hub/server/src/activity/sessions.ts`
- Plan parsing: `findPlanTodos` in `@clara/api-contract`
- The hub asks each online harness for `/sessions/active`, pending
  `/permissions`, and every page of non-archived `/sessions`. It overlays Clara
  project, title, archive, and snooze metadata, then reads each session's
  mailbox signals. Plans come from the newest assistant-message page for the
  first 50 sessions in the plan budget. Plans and signals are cached per
  harness/session; `?refresh=true` bypasses both caches.
- Related: [sessions](sessions.md), [session-info](session-info.md),
  [capabilities](capabilities.md), [API](../architecture/api.md)

</details>
