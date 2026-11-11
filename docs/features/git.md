# Git changes, history, and worktrees

## Summary

The Git tab answers "what branch am I on, what has changed, what did this
session commit, and where are my worktrees?" without leaving the chat. It has
three views: **Changes** for the working tree and commit ranges, **Commits** for
the commits made between the session start and its latest message with a
conventional-commit preview, and **Worktrees** for every worktree the project
knows about.

All three read the repository on the **OpenCode host**, at the selected
session's own directory. The browser never reads its own filesystem.

## User flow

1. Open a session and press the panel button in the header, or `ctrl+x` then `g`.
2. On wide screens the right panel opens on the Git tab; on narrow screens it
   opens as a sheet.
3. Read the current branch at the top. A `default` badge appears when the current
   branch is also the repository's default branch.
4. **Changes** (the default):
   - Pick a range from **Compare**: **Working tree**, **Last 3 commits**, or
     **Base branch**.
   - Read the file count, total additions and deletions, the two-color change
     bar, and the per-file rows. Each row shows `A`, `M`, or `D`, the file name,
     its directory, line counts, and a small churn bar.
5. **Commits**:
   - Read the commits made between this session's creation and its latest
     message. Clara passes both bounds to `git log` and asks for at most ten.
     Each row shows the short hash and the subject, parsed into a conventional
     `type(scope): description` when it follows the convention.
   - The type is colored by kind, the scope in its own color, and the
     description in the normal text color. Non-conventional subjects render as
     written.
   - Click a row to expand it. The expanded row shows the author date, the
     author, any co-authors, and the rest of the commit message.
   - Rows open independently, so several commits can be expanded at once.
6. **Worktrees**:
   - Read every worktree in the project. The project's canonical directory is
     marked `default`; the directory this session runs in is marked `current`
     and highlighted.
   - Press the rescan button to ask OpenCode to rediscover worktrees, for
     example after one was created outside OpenCode.
7. Press the header refresh button to re-read git without reloading the page.
   Only the active view refetches, so refreshing **Changes** never runs a
   `git log`.
8. Switch back to **Info** for context, cost, and timing.

## Core business rules

1. Git data is scoped to the selected session's `location.directory`, not to the
   project. A session moved to a worktree shows that worktree's branch,
   changes, and commits.
2. **Working tree** lists uncommitted changes from the server's VCS status
   endpoint. It is the default range because it is the most frequently useful.
3. **Last 3 commits** compares `HEAD~3..HEAD`. **Base branch** compares the
   branch against its default base. Neither includes uncommitted work.
4. **Commits** runs exactly one command shape on the host:
   `git log --since=<session start> --until=<latest activity> -n 10
--format=%H%x1f%an%x1f%ae%x1f%aI%x1f%s%x1f%b%x1e`. Both bounds are numeric
   timestamps from session metadata, never page or user input, and are emitted
   as ISO strings; the `--since`/`--until` filter happens on the host, so the
   view never fetches the repository's latest ten commits. The upper bound is
   the newest assistant or shell message completion, or the newest message
   creation when there is none. It is omitted while a turn is running so the
   current turn's commits count; the bound closes when the session goes idle.
   The field and record separators keep multiline bodies intact. Conventional
   headers are split into type, scope, and description for the preview, and
   `Co-authored-by:` trailers are lifted out of the body.
5. **Commits only work through the hub.** The request travels over the
   encrypted session, the hub applies the admin shell policy, and only then is
   it forwarded to OpenCode's shell API.
6. If the hub policy blocks the command, the hub returns `403` and the view
   says commit history is disabled on this server. If the OpenCode version has no
   shell routes, the view says history is unavailable.
7. **Worktrees are project-wide.** The server returns directories only, so:
   - `default` is the entry equal to the project's canonical directory,
   - `current` is the entry equal to this session's directory,
   - if the server omits the canonical directory, Clara synthesizes the default
     row so the list is still understandable.
8. The panel is read-only toward the repository. It never stages, commits,
   checks out, creates, or removes anything.
9. Files are sorted by total churn, highest first, and every change bar is scaled
   against the largest file in the current range.
10. Commits and worktrees live under their own query root (`['git', …]`) so the
    frequent `filesystem.changed` invalidation of `['vcs', …]` cannot spawn a
    `git log` on every file write. History refreshes on `vcs.branch.updated`, at
    the end of an agent turn, and on manual refresh.

## Edge cases

- **Not a git repository** — the panel shows "Not a git repository" with the
  directory path and no views.
- **Fewer than three commits** — "Last 3 commits" fails; the panel explains the
  short history and offers **Show last commit**, which compares `HEAD~1..HEAD`.
- **Shallow clone** — the same short-history message appears until the missing
  history is fetched.
- **Detached HEAD** — the branch row shows `detached HEAD`, the default badge is
  hidden, and `git log` still works.
- **No commits in this session** — the view shows "No commits since this
  session started." even when the directory has older history. A repository with
  no commits at all lands in the same state instead of an error.
- **Non-conventional subject** — the row shows the subject unchanged, with no
  type or scope colors.
- **No commit body** — the expanded row shows the date and author only.
- **Co-author trailers** — each `Co-authored-by:` line is shown under
  Co-authors and removed from the message; other trailers stay in the message.
- **No default branch or base** — **Base branch** is disabled and the panel falls
  back to the working tree.
- **Clean tree or empty range** — the file list is replaced by "No changes in
  this range."
- **Session switched** — queries are keyed by directory and the session window,
  so the previous session's branch, commits, and current worktree never linger.
- **Session running** — the commit window has no upper bound while the agent is
  working, so the current turn's commits count. When the session goes idle, the
  latest message closes the window and the list refetches.
- **Session in a worktree** — commits and changes come from the worktree.
  `vcs.base` returns `503 Choose a review base` there, so **Base branch** can
  fail even though the branch name is known.
- **Worktree removed or directory deleted** — the git requests fail with the
  normal retry states.
- **Worktree created outside OpenCode** — the list is discovery-backed and may
  lag until the rescan button runs `POST /api/worktree/refresh`.
- **No other worktrees** — the list still shows the default row; there is no
  special empty state beyond "No worktrees reported." when the server returns
  nothing.
- **Session has no project record** — the Worktrees view explains that worktrees
  are unavailable rather than guessing a project.
- **Server policy blocks commands** — the Commits view shows an admin-disabled
  state with no retry loop.
- **Git tab closed** — no git, history, or worktree requests run while another
  panel tab is showing.

## Not a sandbox

**The shell policy is a guardrail, not a sandbox.** It decides whether the hub
forwards a **command request** from a Clara client to OpenCode. It is not a
capability boundary for the OpenCode API:

- Any client that reaches OpenCode can still use APIs that are not command
  requests. Writing files (`/api/experimental/fs/write`), starting a session and
  prompting an agent, or calling a plugin RPC (`/api/rpc/{rpcID}/{method}`) can
  all have effects on the host.
- A modified web build can still call non-command OpenCode APIs through the
  hub, and the hub forwards them.
- The policy itself is changed from the loopback panel, which has no
  authentication beyond being reachable only from the machine.

A real sandbox needs a positive allowlist of every proxied API route (or a
separate process boundary) and is future work. Until then, treat the policy as a
way to keep the web client from running commands, not as protection against a
hostile client or a compromised origin.

## Out of scope

- Staging, committing, discarding, checking out, pushing, or resetting
- Patch or line-by-line diff review
- Blame, per-file history, or a commit-diff/browse view
- Creating, removing, switching, or moving sessions between worktrees
- A configurable history length, pagination, or a diff-level commit detail view
- Working tree status for each worktree row
- Initializing a repository from Clara

## Known gaps

- **No commit-log endpoint exists.** OpenCode 2.1.x and 2.2.x expose
  `vcs.get/base/status/diff/branch` only, so history needs `git log` through the
  shell API. That is why the feature depends on the hub and its shell
  policy.
- **Session scope is time-based.** OpenCode records no commit IDs for a session,
  so Clara asks git for commits between `session.time.created` and the newest
  message activity. Git compares commit dates, not author dates: a manual commit
  made in the same directory inside the window is included, an amended commit
  shows its original author date, and commits made after the latest message are
  excluded. A window with more than ten commits shows only the newest ten.
- **Each history read spawns a process** on the host and writes a small shell job
  file that Clara removes afterwards. On a slow volume or a very large
  repository, expect a short delay; the request is capped at ten seconds.
  Expanding a row never starts another process; the details arrive with the
  same log.
- **A non-empty filter must cover the formatted command.** The panel's **Allow
  Git history** toggle adds `git log`, which covers it. An entry pinned to the
  old `git log --oneline -n 10` string blocks the new command until it is
  updated. An empty filter list allows every command, so Git history works
  without an entry.
- **The worktree list has no branch names, HEAD, or dirty state.** Enriching rows
  would need one `vcs.get` call per worktree.
- **The worktree list is stored by OpenCode**, not read live, so it can be stale
  until a rescan.
- **`vcs.base` fails inside a worktree**, so **Base branch** is unreliable for
  worktree sessions.
- **The file list is not virtualized**; a very large changeset renders every row
  in the panel.

## Technical appendix

<details>
<summary>Routes, data, and references</summary>

- Panel shell and tabs: `src/components/layout/side-panel.tsx`
- Git view: `src/components/layout/git-panel.tsx`
- Commit view: `src/components/layout/git-commit-list.tsx`
- Commit row: `src/components/layout/git-commit-row.tsx`
- Worktree view: `src/components/layout/git-worktree-list.tsx`
- Shared messages: `src/components/layout/git-panel-parts.tsx`
- Hooks and parsers: `src/features/git/use-git.ts` (`gitLogCommand`,
  `lastSessionActivity`, `parseGitLog`, `parseConventionalHeader`,
  `splitCommitBody`)
- Branch and provider: `client.vcs.get({ location: { directory } })`
- Review base: `client.vcs.base({ location: { directory } })`
- Working tree: `client.vcs.status({ location: { directory } })`
- Committed and branch ranges: `client.vcs.diff({ mode, base, context: 0 })`
- History: `client.shell.create({ command: gitLogCommand(window), cwd })`,
  polled with `shell.get`, read with `shell.output`, cleaned with `shell.remove`
- Worktrees: `client.worktree.list({ projectID })` and
  `client.worktree.refresh({ projectID })`
- Project ID: the canonical project record for the route, passed from the chat
  page so worktree lookups use the record that owns them
- Shell policy: enforced in `apps/server/src/shell-policy.ts` before
  `OpenCodeClient.request` runs; see [panel](panel.md)
- Live updates: `filesystem.changed` for changes, `vcs.branch.updated` and
  session idle/execution events for history, `worktree.updated` and
  `worktree.resolved` for worktrees
- Query keys: `['vcs', …]` for changes, `['git', 'commits', directory, since,
until]` and `['git', 'worktrees', projectID, directory]` for history and
  worktrees
- The selected panel tab is stored as `clara.sidePanelTab`; the compare range and
  the Git view reset when the Git tab remounts.
- Related: [session-info](session-info.md), [shortcuts](shortcuts.md),
  [panel](panel.md), [capabilities](capabilities.md)

</details>
