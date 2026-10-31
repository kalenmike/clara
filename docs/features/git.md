# Git changes

## Summary

The Git tab answers "what branch am I on, and what has changed?" without leaving
the chat. It shows the active branch, its default base, and a compact
additions/deletions summary for the working tree, the last three commits, or the
whole branch.

## User flow

1. Open a session and press the panel button in the header, or `ctrl+x` then `g`.
2. On wide screens the right panel opens on the Git tab; on narrow screens it
   opens as a sheet.
3. Read the current branch at the top. A `default` badge appears when the current
   branch is also the repository's default branch.
4. Pick a range from the **Compare** menu: **Working tree**, **Last 3 commits**,
   or **Base branch**.
5. Read the summary: file count, total additions and deletions, and a two-color
   change bar.
6. Scan the file list. Each row shows `A`, `M`, or `D`, the file name, its
   directory, line counts, and a small churn bar.
7. Press the refresh button to re-read git without reloading the page. The panel
   also refreshes itself when files or branches change during a run.
8. Switch back to **Info** for context, cost, and timing.

## Core business rules

1. Git data is scoped to the project directory attached to the selected session,
   not to the session itself.
2. **Working tree** lists uncommitted changes from the server's VCS status
   endpoint. It is the default range because it is the most frequently useful.
3. **Last 3 commits** compares `HEAD~3..HEAD`, so it excludes uncommitted work.
   **Base branch** compares the branch against its default base and excludes
   uncommitted work as well.
4. The panel is read-only. It never stages, commits, checks out, or writes files.
5. Files are sorted by total churn, highest first, and every change bar is scaled
   against the largest file in the current range.

## Edge cases

- **Not a git repository** — the panel shows "Not a git repository" with the
  directory path and no compare controls.
- **Fewer than three commits** — "Last 3 commits" fails; the panel explains the
  short history and offers **Show last commit**, which compares `HEAD~1..HEAD`.
- **Shallow clone** — the same short-history message appears until the missing
  history is fetched.
- **Detached HEAD** — the branch row shows `detached HEAD`, and the default badge
  is hidden.
- **No default branch or base** — **Base branch** is disabled and the panel falls
  back to the working tree.
- **Clean tree or empty range** — the file list is replaced by "No changes in
  this range."
- **Base equals current** — or when the working tree is clean, the summary shows
  zero files rather than an error.
- **Server does not support VCS** — the git request shows a retry state; the Info
  tab keeps working.
- **Session switched** — queries are keyed by directory, so the previous
  project's branch and files never linger.
- **Git tab closed** — no git requests run while the Info tab is showing.

## Out of scope

- Staging, committing, discarding, checking out, or pushing
- Patch or line-by-line diff review
- Blame, file history, or browsing individual commits
- Worktree management
- A configurable commit count beyond the fixed `HEAD~3`
- Initializing a repository from Clara

## Known gaps

- The VCS diff endpoint returns patch text even when only statistics are needed.
  The panel asks for zero context and discards the patches, so a very large range
  can still transfer more data than the summary uses.
- The working tree range uses the status endpoint, which has no patch payload;
  the other two ranges use the diff endpoint.
- There is no commit-count endpoint, so the panel learns that a repository has
  fewer than three commits only after `HEAD~3` fails.
- The file list is not virtualized; a very large changeset renders every row in
  the panel.

## Technical appendix

<details>
<summary>Routes, data, and references</summary>

- Panel shell and tabs: `src/components/layout/side-panel.tsx`
- Git view: `src/components/layout/git-panel.tsx`
- Hooks: `src/features/git/use-git.ts`
- Branch and provider: `client.vcs.get({ location: { directory } })`
- Review base: `client.vcs.base({ location: { directory } })`
- Working tree: `client.vcs.status({ location: { directory } })`
- Committed and branch ranges: `client.vcs.diff({ mode, base, context: 0 })`
- Live updates: `filesystem.changed`, `vcs.branch.updated`, and the existing
  `session.idle` / execution-finished invalidations
- The selected tab is stored as `clara.sidePanelTab`; the compare range resets to
  the working tree when the Git tab remounts.
- Related: [session-info](session-info.md), [shortcuts](shortcuts.md),
  [capabilities](capabilities.md)

</details>
