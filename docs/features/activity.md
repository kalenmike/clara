# Running agents

## Summary

The Running agents page shows every session where an agent is working across all
paired harnesses. Each session shows its project, harness, token totals, reported
spend, and current plan. It is a read-only overview for people who run work on
more than one harness.

## User flow

1. Choose the activity icon in the sidebar header.
2. Read the summary for the number of running sessions, harnesses, tokens, and
   reported spend.
3. Read each harness section. Sessions are grouped under the harness that owns
   them, newest activity first.
4. Read a session card for its project, agent, model, last update, token total,
   and reported spend.
5. Read the plan checklist for that session. The header shows completed items
   against the total.
6. On the active harness, choose a session title to open it.
7. Leave the page open. It refreshes every ten seconds, or press **Refresh** to
   reload immediately and bypass the short plan cache.
8. Read the Other harnesses row to see paired harnesses that are idle, offline,
   or could not be checked.

## Core business rules

1. A session appears only while the harness reports it as running. The hub asks
   every paired harness for its active-session map instead of using only the
   active harness.
2. Session totals and spend come from the session record the harness returns.
   Spend is the amount the harness reports, not a price estimate.
3. The plan is the newest completed `todowrite` call in the session transcript.
   An empty list means the agent cleared the plan.
4. A harness that is offline or fails its lookup is reported on the page without
   hiding results from other harnesses.
5. The page polls. Cross-harness status events are not streamed to the browser,
   so the hub does not push updates for harnesses other than the active one.
6. Opening a session only works from the active harness. Other harnesses stay
   read-only until the chat routes can address a harness explicitly.

## Edge cases

- **No harnesses paired** — the page explains that a harness must be paired
  first.
- **No agents running** — the page keeps the harness status visible and explains
  that sessions appear while an agent is working.
- **Harness offline** — its sessions cannot be read, so it appears as offline.
- **Partial harness failure** — sessions that loaded still appear; the harness
  is marked Partial with a count of sessions that could not be loaded.
- **Transcript unavailable** — the session still appears, and its plan says
  Plan unavailable.
- **No plan** — the card says No plan yet.
- **Unknown project** — the card shows the harness project ID and does not offer
  a link.
- **Session on another harness** — the card is readable but has no open link.
- **Long checklist** — the plan area scrolls inside the card.
- **Page left open** — the query refreshes every ten seconds and shows the last
  successful result if a refresh fails.

## Out of scope

- Starting, steering, interrupting, or deleting sessions from this page.
- Switching the active harness from this page.
- Opening a session on a non-active harness.
- Estimated spend across harnesses.
- Historical spend, usage charts, file activity, or a waterfall timeline.
- Comparing sessions side by side.

## Known gaps

- Spend does not follow the estimated-cost setting because model catalogs are
  scoped to each harness.
- Plans can be up to five seconds stale during automatic polling. The Refresh
  button bypasses that cache.
- Click-through is limited to the active harness.
- A session whose metadata fails to load is omitted from the card list and
  counted as a partial harness failure.

## Technical appendix

<details>
<summary>Routes, data, and references</summary>

- Endpoint: `GET /v1/activity/running`
- Response: `ClaraRunningSessionsResponse` in `@clara/api-contract`
- Page: `apps/web/src/pages/activity-page.tsx`
- Cards: `apps/web/src/components/activity/`
- Hook: `apps/web/src/features/activity/use-running-activity.ts`
- Hub fan-out: `apps/hub/server/src/activity/running.ts`
- Plan parsing: `findPlanTodos` in `@clara/api-contract`
- The hub asks each online harness for `/sessions/active`, then reads the
  running sessions and their context. Context results are cached per
  harness/session for five seconds; `?refresh=true` bypasses the cache.
- Session overlay maps harness project IDs to Clara project and workspace IDs
  and applies Clara title, archive, and snooze metadata.
- Related: [sessions](sessions.md), [session-info](session-info.md),
  [capabilities](capabilities.md), [API](../architecture/api.md)

</details>
