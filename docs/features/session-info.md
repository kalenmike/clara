# Session info

## Summary

The session info panel answers "how big is this conversation and what has it
cost?" It shows context usage against the model limit, token breakdowns, message
counts, timing, and the active model's limits.

## User flow

1. Open a session and press the panel button in the header, or `ctrl+x` then `s`.
2. On wide screens the panel opens on the right; on narrow screens it opens as a
   sheet.
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
3. Message counts come from the full session context, not the visible 100-message
   page.
4. The panel is available on every session, including empty ones.
5. The panel is read-only; it never changes the session.

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
- **Narrow viewport** — the panel becomes a sheet and does not overlap the
  composer when closed.

## Out of scope

- Billing history, invoices, or provider dashboards
- Per-message or per-tool cost attribution
- Exporting usage data
- Context editing or trimming from the panel

## Known gaps

- Context usage is an estimate: it sums input and cache tokens from the last
  assistant message rather than the server's internal context accounting.
- The panel does not show a breakdown of context by file or tool output.

## Technical appendix

<details>
<summary>Routes, data, and references</summary>

- Component: `src/components/layout/session-info-panel.tsx`
- Session: `client.session.get({ sessionID })`
- Context entries: `client.session.context({ sessionID })`
- Models and limits: `client.model.list()`
- Live usage: `session.usage.updated`, `session.step.ended`
- Related: [chat](chat.md), [capabilities](capabilities.md)

</details>
