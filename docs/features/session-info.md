# Session info

## Summary

The session info tab answers "how big is this conversation and what has it
cost?" It shows context usage against the model limit, token breakdowns, message
counts, timing, and the active model's limits. It shares the right panel with
the [Git](git.md) tab and the [pair terminal](pair-terminal.md).

## User flow

1. Open a session and press the panel button in the header, or `ctrl+x` then `s`.
   The panel opens on the Info tab; use the Git or Terminal tab beside it for
   branch and change information or a live command log.
2. On wide screens the panel opens on the right; drag its left edge to resize it
   between 240 and 640px (capped so the chat keeps usable width), or double-click
   the handle to reset. On narrow screens it opens as a sheet.
3. Read context usage as a percentage and bar, with used and limit tokens.
4. Read cost and the input, output, reasoning, cache-read, and cache-write totals.
5. Read message counts: prompts from you, replies from the agent, tool calls, and
   total context entries.
6. Read session timing and the model's context and output limits.
7. Leave the panel open; it updates as usage events arrive.

## Core business rules

1. Context usage uses the latest assistant message's tokens plus cache reads and
   writes, measured against the model's context limit.
2. Cost and token totals prefer live usage events, then fall back to the session
   record.
3. Message counts come from the full session context, not the pages loaded in
   the chat.
4. The panel is available on every session, including empty ones.
5. The panel is read-only; it never changes the session. The selected tab and the
   panel width are remembered across reloads, and only the visible tab loads its
   data. The width is shared by the Info, Git, and Terminal tabs.

## Edge cases

- **No assistant reply yet** — context falls back to the session's input tokens
  and shows 0% when no limit is known.
- **Unknown model** — the limit row shows a dash and the bar stays at its minimum
  width.
- **Usage event missing** — values come from the session query and update on the
  next refetch.
- **Context request fails** — counts show zero while cost and timing still render.
- **Cache-heavy session** — cache reads can exceed the context limit input; the
  percentage caps at 100.
- **Huge counts** — numbers are compacted (for example 1.2M).
- **Session without an agent or model** — badges fall back to `build` and
  `default`.
- **Narrow viewport** — the panel becomes a sheet and does not overlap the reply
  window when closed.
- **Small desktop viewport** — the panel's maximum width shrinks so the chat keeps
  at least 360px beside the sidebar.
- **Switching sessions with the panel open** — it re-reads the new session and
  never keeps the previous session's numbers.

## Out of scope

- Billing history, invoices, or provider dashboards
- Per-message or per-tool cost attribution
- Exporting usage data
- Comparing sessions side by side
- Context editing or trimming from the panel

## Known gaps

- Context usage is an estimate: it sums input and cache tokens from the last
  assistant message rather than the server's internal context accounting.
- The panel does not show a breakdown of context by file or tool output.
- Context entries are fetched whenever the panel mounts, even for very large
  sessions.

## Technical appendix

<details>
<summary>Routes, data, and references</summary>

- Component: `src/components/layout/session-info-panel.tsx`
- Tab shell: `src/components/layout/side-panel.tsx`
- Resize: `src/hooks/use-side-panel-width.ts` over the shared
  `src/hooks/use-panel-width.ts`; width stored in `clara.sidePanelWidth`
  (240–640px, default 320px)
- Session: `client.session.get({ sessionID })`
- Context entries: `client.session.context({ sessionID })`
- Models and limits: `client.model.list()`
- Live usage: `session.usage.updated`, `session.step.ended`
- Context percentages are clamped to 100 and never show a negative width.
- Related: [chat](chat.md), [git](git.md), [capabilities](capabilities.md)

</details>
