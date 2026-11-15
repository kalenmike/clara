# Session panel

## Summary

The session panel is the right-hand column of a session: one shell with **Info**,
**Git**, and **Terminal** tabs and a **Plan** dock pinned below them. It answers
"how big is this conversation, what has changed, what is the agent running, and
what is it planning?" on every session, including a draft.

## User flow

1. Open a session and press the panel button in the chat header, or `ctrl+x` then
   `s` for Info, `g` for Git, or `` ` `` for Terminal. The panel remembers the tab
   you used last.
2. On wide screens the panel docks on the right; drag its left edge to resize, or
   double-click the handle to reset. On narrow screens it opens as a sheet.
3. **Info** shows context usage, cost, token totals, message counts, timing, and
   the model's limits, and keeps updating as usage events arrive.
4. Read the **Plan** dock on every tab: the agent's checklist and progress, or a
   **Request Plan** button when no list exists. A long list scrolls inside it.
5. Press **Request Plan**, or **Request Update** when a list exists, to steer the
   agent toward writing or refreshing its todos. The button stays pending until
   the request is answered.
6. **Git → Changes** shows the branch, totals, and per-file rows for the selected
   range; the refresh button re-reads git without reloading the page.
7. **Git → Commits** lists this session's commits and expands a row for author,
   date, co-authors, and body. **Git → Worktrees** marks `default` and `current`
   and rescans on demand.
8. **Terminal** lists the agent's commands with one-line entries for other tools.
   Select a command to open its output and error, and select it again to fold it
   away; running and failed commands say so inline. Scroll up to inspect; press
   **Jump to live** to resume following.

## Core business rules

1. **One shell, shared state.** The tabs share a remembered tab
   (`clara.sidePanelTab`) and width (`clara.sidePanelWidth`, 240–640px, default
   320px, capped so the chat keeps 360px); narrow viewports get a sheet. Only the
   visible tab loads its data, and the Plan dock stays mounted below the tabs.
2. **Info is read-only.** Context usage is the latest assistant message's input
   tokens plus cache reads and writes, against the model's context limit and
   clamped to 100. Totals prefer live usage events, then the session record. Counts
   cover the full context, and synthetic messages count under **from automation**.
3. **Cost follows the Cost display setting.** **Actual** shows the reported
   amount; **estimated** multiplies input, output, reasoning (at the output rate),
   cache-read, and cache-write tokens by the model's price tier, marks the value
   with `~`, and falls back to the reported cost when the model or price is
   unknown. Prices come from the session's harness catalog, the tier from the
   latest request.
4. **The Plan dock reads the agent's todos.** It renders the newest completed
   `todowrite` call in server order, falling back to the full session context, and
   never edits them. An empty list counts as cleared, malformed items are skipped,
   and a forked session ignores plans written before the fork.
5. **Plan requests are steering only.** They send short synthetic inputs, do not
   switch the agent or start work, and reach a busy session at the next safe step
   boundary without interrupting a tool call. While the newest request is
   unanswered the button is disabled with a spinner; it unlocks on a later
   `todowrite`, after five assistant messages and tool calls without one, or when
   the run stops. Pending state lives in the transcript and survives a reload.
6. **Git is scoped to the session directory and read-only.** **Working tree** (the
   default), **Last 3 commits** (`HEAD~3..HEAD`), and **Base branch** compare at
   the session's `location.directory`, not the project, and files are sorted by
   churn. The panel never writes to the repository; git runs on the harness host
   only, per [Host command policy](../architecture/overview.md#host-command-policy).
7. **Commits use one fixed command.** The hub builds
   `git log --since=<session start> --until=<latest activity> -n 10` from
   validated timestamps, forwards it to the harness that owns the directory, and
   leaves the bound open until idle. Conventional headers split into type, scope,
   and description. **Worktrees** are project-wide, canonical as `default`.
8. **The terminal is read-only.** Shell commands show the command line, status
   and duration, and keep streamed and final output folded behind a per-command
   toggle that starts closed; other tools appear as compact activity lines. The
   event stream is authoritative and history backfills completed commands. Output
   is text only: ANSI escapes are stripped, carriage returns collapse, and each
   command keeps the last 400 lines; following pauses on scroll.

## Edge cases

- **No usage yet, unknown model, or free model** — context falls back to the
  session's input tokens with a 0% bar and a dash for the limit, and a free model
  estimates `$0.00`.
- **Tiered or model-switched session** — totals use the latest request's tier and
  current model, so they are approximate while per-message footers stay exact.
- **No todo tool, or a plan request nobody answers** — the list stays empty when
  the server has not enabled `experimental.todo`, and a request stays pending
  until the session stops or five messages arrive.
- **Draft session** — the Plan dock asks the person to send their brief and shows
  no request button.
- **Not a repository, or short history** — the Git tab says so, and **Last 3
  commits** offers **Show last commit** instead.
- **No commits in this session** — the list says so even when older history
  exists, and a non-conventional subject renders as written.
- **Worktree session or no default base** — `vcs.base` fails there, so **Base
  branch** is disabled or errors even though the branch name is known.
- **Ambiguous or disabled harness** — a directory linked to two harnesses asks the
  person to choose, and disabled access shows an admin-disabled state.
- **Terminal with a failed, long, or quiet command** — the folded row shows the
  error and exit status, opening it reveals the message, and the log keeps the
  newest lines with a truncation notice; a command without progress events
  appears when it finishes.
- **Switching sessions with the panel open** — the panel re-reads the new session;
  numbers, commits, worktree markers, and commands never linger.

## Out of scope

- Billing history, invoices, provider dashboards, or quota and allowance display
- Per-message, per-tool, or exported cost attribution, and session comparison
- Editing or trimming context, or creating, editing, reordering, and completing
  todos from Clara
- Staging, committing, discarding, pushing, resetting, reviewing patches, blame,
  per-file history, pagination, and diff-level commit views
- Interactive shells, PTYs, stdin, full terminal emulation, running or approving
  commands from the terminal, and persisting or searching terminal output

## Known gaps

- Context usage, and session-level estimated cost, are approximations that sum
  message and cache tokens; a switched model makes the total approximate, and
  context is never broken down by file or tool output.
- The harness API has no todo endpoint or todo event, so Plan depends on the
  `todowrite` call being present in the transcript.
- Commit scope is time-based: a manual commit inside the window is included, an
  amended commit shows its original author date, later commits are excluded, and
  more than ten commits show only the newest ten.
- Each history read spawns one ten-second host process, while expanding a row never
  starts another; the worktree list lacks branch, HEAD, or dirty state, is stored
  by the harness, and can lag until a rescan.
- The terminal only backfills messages the chat has loaded, and the server may
  truncate command output before it arrives.

## Technical appendix

<details>
<summary>Routes, data, and references</summary>

- Panel shell and tabs: `src/components/layout/side-panel.tsx`; width from
  `src/hooks/use-side-panel-width.ts` over `src/hooks/use-panel-width.ts`
- Plan: `src/components/layout/session-plan-dock.tsx` and `session-plan.tsx`;
  parsing in `src/features/chat/session-plan.ts`; pending state in
  `src/features/chat/plan-request.ts`
- Info: `src/components/layout/session-info-panel.tsx`, `client.session.get`,
  `client.session.context`, `client.model.list({ harnessID })`,
  `src/features/cost/*` (`clara.costDisplay`), `session.usage.updated`
- Git: `src/components/layout/git-panel.tsx`; `src/features/git/use-git.ts`;
  `client.vcs.get/base/status/diff`, `client.worktree.list/refresh`,
  `client.git.log` over `GET /v1/git/log` (`apps/hub/server/src/api/git.ts`)
- Terminal: `src/components/chat/pair-terminal.tsx` (per-command fold state),
  `src/features/chat/terminal-log.ts` (400 output lines, 300 entries),
  `src/features/chat/chat-store.ts`, `session.tool.*` events
- Related: [chat](chat/index.md), [composer](chat/composer.md),
  [sessions](sessions/index.md), [capabilities](capabilities.md)

</details>
