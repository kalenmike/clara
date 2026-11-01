# Session info

## Summary

The session info tab answers "how big is this conversation and what has it
cost?" It shows context usage against the model limit, token breakdowns, message
counts, timing, and the active model's limits. Its Plan section also renders the
agent's todo checklist when the session has one. It shares the right panel with
the [Git](git.md) tab and the [pair terminal](pair-terminal.md).

## User flow

1. Open a session and press the panel button in the header, or `ctrl+x` then `s`.
   The panel opens on the Info tab; use the Git or Terminal tab beside it for
   branch and change information or a live command log.
2. On wide screens the panel opens on the right; drag its left edge to resize it
   between 240 and 640px (capped so the chat keeps usable width), or double-click
   the handle to reset. On narrow screens it opens as a sheet.
3. Read the Plan section below the session name. It shows the agent's todo
   checklist and progress, or a **Request Plan** button when no list exists.
4. Press **Request Plan** to steer the agent toward writing a todo list. With a
   list present, press **Request Update** to ask for the current plan and
   progress. Both send a short synthetic input, so the request appears in the
   thread as a system event rather than a prompt the person typed. The button
   stays available while the agent is working: steering is delivered at the next
   safe boundary and the input tells the agent to update the checklist and carry
   on. An empty draft shows "Send your brief to view the plan" instead.
5. Read context usage as a percentage and bar, then cost and the input, output,
   reasoning, cache-read, and cache-write totals.
6. Read message counts: prompts from you, replies from the agent, tool calls, and
   total context entries.
7. Read session timing and the model's context and output limits.
8. Leave the panel open; it updates as usage events arrive.

## Core business rules

1. Context usage uses the latest assistant message's tokens plus cache reads and
   writes, measured against the model's context limit.
2. Cost and token totals prefer live usage events, then fall back to the session
   record.
3. Message counts come from the full session context, not the pages loaded in
   the chat.
4. The panel is available on every session, including empty ones.
5. The panel is read-only except for the Plan requests. The selected tab and the
   panel width are remembered across reloads, and only the visible tab loads its
   data. The width is shared by the Info, Git, and Terminal tabs.
6. Plan reads the newest completed `todowrite` tool call from the loaded
   transcript, falling back to the full session context for an older list. An
   empty list counts as a cleared plan. A forked session ignores plans written
   before the fork, so the branch starts with its own checklist. The checklist
   is rendered in server order and never edited locally.
7. Request Plan and Request Update send short steering synthetic inputs. They do
   not switch the agent or start work. A busy request is delivered at the next
   safe step boundary, does not interrupt the current tool call, and asks the
   agent to continue after refreshing the list.

## Edge cases

- **No assistant reply or usage event yet** — context falls back to the session's
  input tokens, shows 0% when no limit is known, and updates on the next refetch.
- **Unknown model** — the limit row shows a dash and the bar stays at its minimum
  width.
- **Context request fails** — counts show zero while cost and timing still render.
- **Cache-heavy or huge session** — the percentage caps at 100 and counts are
  compacted (for example 1.2M).
- **Session without an agent or model** — badges fall back to `build` and
  `default`.
- **Narrow or small desktop viewport** — the panel becomes a sheet, or its maximum
  width shrinks so the chat keeps at least 360px beside the sidebar.
- **Switching sessions with the panel open** — it re-reads the new session and
  never keeps the previous session's numbers.
- **No todo tool** — the server has not enabled `experimental.todo`, so the list
  stays empty and Request Plan cannot create one.
- **Cleared or running plan** — an empty `todowrite` clears the section, malformed
  items are skipped, and the previous completed plan stays visible while a new
  call is running.
- **Forked session** — the copied parent checklist is hidden because it was
  written before the branch existed. The Plan section starts empty and shows the
  branch's own `todowrite` once the agent writes one.
- **Draft session** — the Plan section asks the person to send their brief and
  shows no request button.

## Out of scope

- Billing history, invoices, or provider dashboards
- Per-message or per-tool cost attribution
- Exporting usage data
- Comparing sessions side by side
- Context editing or trimming from the panel
- Creating, editing, reordering, or completing todos from Clara; the plan is a
  read-only rendering that the agent owns

## Known gaps

- Context usage is an estimate: it sums input and cache tokens from the last
  assistant message rather than the server's internal context accounting.
- The panel does not show a breakdown of context by file or tool output.
- Context entries are fetched whenever the panel mounts, even for very large
  sessions.
- The v2 API has no todo endpoint or todo event, so Plan depends on the
  `todowrite` tool call being present in the transcript.

## Technical appendix

<details>
<summary>Routes, data, and references</summary>

- Component: `src/components/layout/session-info-panel.tsx`
- Plan section: `src/components/layout/session-plan.tsx`
- Plan parsing: `src/features/chat/session-plan.ts` reads the newest completed
  `todowrite` tool part and its `state.input.todos` array; an empty array means
  the agent cleared the list. Forked sessions pass the session creation time so
  copies of the parent's `todowrite` calls are ignored.
- Plan requests: `client.session.prompt({ delivery: "steer" })`
- Tab shell: `src/components/layout/side-panel.tsx`
- Resize: `src/hooks/use-side-panel-width.ts` over the shared
  `src/hooks/use-panel-width.ts`; width stored in `clara.sidePanelWidth`
  (240–640px, default 320px)
- Session: `client.session.get({ sessionID })`
- Context entries: `client.session.context({ sessionID })`
- Models and limits: `client.model.list()`
- Live usage: `session.usage.updated`, `session.step.ended`
- Server prerequisite: OpenCode must enable `experimental.todo` before it
  registers the `todowrite` tool
- Context percentages are clamped to 100 and never show a negative width.
- Related: [chat](chat.md), [git](git.md), [capabilities](capabilities.md)

</details>
