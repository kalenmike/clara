---
request: 2
slug: multi-session-delete
workspace: clara
pipeline: software@1
state: accepted
created: 2026-11-09T03:07:09.174Z
---

# 002 — Multi-session delete in the session list

## Status

Accepted for delivery. This revision incorporates the review findings from the
first implementation pass. Scope is the web session list rendered by the sidebar
on desktop and in the mobile navigation drawer. No server, relay, crypto, or
wire-format change is required.

This record is a request-level artifact. It is not part of the canonical feature
docs index; the current behavior lives in `docs/features/sessions.md` and
`docs/features/shortcuts.md`.

## Summary

People can select a contiguous range of sessions in the sidebar and permanently
delete the selection after an explicit destructive confirmation. The affordance
is invisible at rest: there is no checkbox column, bulk toolbar, or delete button
until a selection exists. Normal clicks keep navigating exactly as they do today.

The implementation must use a pre-deletion snapshot to restore focus after a
successful delete, retain the confirmation dialog's snapshot through its close
animation, keep the hidden desktop sidebar from acting on stale selection, and
cover the selection and focus rules with behavioral tests rather than source-text
assertions.

## User-visible outcome

- The resting session list is visually unchanged.
- A normal click clears any selection and opens the clicked session.
- Shift-click extends a selection from the anchor row to the clicked row and
  never navigates. Shift+Enter does the same from a focused row.
- While a selection exists, a compact selection bar shows the count, a Clear
  action, a Delete action, and the keyboard hint. Selected rows are visibly
  marked.
- Delete or Backspace with a non-empty selection opens a destructive
  confirmation dialog. Nothing is removed until the destructive action is
  confirmed.
- Escape, Cancel, the close control, clicking outside, and the selection bar's
  Clear action dismiss or clear without deleting.
- The dialog never flashes a zero count or “Delete 0 …” while closing. Its last
  snapshot remains visible through the dismissal animation.
- A partial failure keeps failed sessions selected, removes successful ones, and
  names the failures in a toast and in the selection bar.
- A result toast appears after the dialog has closed, never while it is still
  visible.
- After a successful delete, focus moves to a surviving row chosen from the
  pre-deletion order. Focus falls back to the search field only when no
  surviving row can receive it.
- After a dismissal, focus returns to a row or to Clear. It never returns to the
  destructive Delete trigger.
- The open session, if successfully deleted, leaves the chat view for the
  project page.
- Clear and Delete controls have at least a 44×44 CSS-pixel touch target on
  mobile.

## User flow

1. Click a session normally. Clara opens it and clears any previous selection.
   That row becomes the anchor.
2. Hold Shift and click another session. Clara selects every rendered row
   between the anchor and the clicked row, inclusive, in the order the list
   displays them. The clicked row does not open.
3. The selection bar appears above the scrollable list with
   “N briefs selected”, a short hint, Clear, and Delete. Each selected row gets a
   persistent selected treatment.
4. Press Delete or Backspace, or activate the Delete action. A modal opens with
   the selected count and an explicit permanence warning.
5. Cancel, press Escape, click outside, or use the close control. The dialog
   closes and every selected session remains. Focus returns to the row that had
   focus, or to the selection bar's Clear control.
6. Confirm with the destructive action. The dialog shows a busy state while
   removals run; it cannot be dismissed or submitted twice.
7. On success, the dialog closes, the list refreshes, the selection clears, and
   a success toast reports the count. Focus moves to the first surviving row
   after the deleted range in the pre-deletion order, or to the previous
   surviving row when there is no row after it. If neither exists, focus moves to
   the search field.
8. On partial failure, the dialog closes, successful rows are gone, failed rows
   stay selected, and an error toast names the failures. Focus moves to the first
   failed selected row, or to Clear when that row is no longer rendered.

## Interaction rules

### Selection model

- Selection state is local React state in the sidebar list instance. It is not
  persisted to local storage, the URL, or the server.
- The anchor is the row from the last normal click, or the target of a first
  shift-click when no anchor exists.
- A shift-click replaces the selection with the inclusive range between the
  anchor and the target. It does not add a discontiguous range.
- Shift-clicking the anchor again selects only the anchor.
- If the anchor is not currently rendered, a shift-click starts a new anchor at
  the target and selects only that row.
- A normal click always clears the selection, sets the clicked row as the new
  anchor, and follows the existing navigation behavior.
- The selection bar's Clear action clears the selected IDs, the anchor, and any
  failure note.
- Changing the selected project or the search query clears selection, anchor,
  and failure note.
- Selection is scoped to one project. Selecting sessions in another project is
  not possible in the same selection.

### Range order

- Rows are ordered as rendered: Inbox, Outbox, Drafts, Snoozed, Archived, then
  Workers. Sessions within a section keep their existing newest-first order.
- Collapsed sections contribute no rows to a new range. Expanding a section
  makes its rows eligible again.
- A selection created before a section collapses survives; the collapsed rows
  remain selected and remain counted. The next shift-click replaces the
  selection using only the rows currently rendered.
- Workers participate like any other session. Deleting a worker is an ordinary
  session delete with no extra confirmation beyond the same modal.

### List updates

- Selection is keyed by session ID, so reordering, mailbox changes, and
  background refetches preserve selected rows.
- After each successful list refresh, selected IDs that no longer appear in the
  current project's active or archived list are pruned. The anchor is dropped
  when its row disappears.
- When pruning changes the selection, the failure note is cleared. A stale
  “Could not delete …” note must not survive after failed IDs disappear or the
  selection is otherwise pruned.
- A failed list refresh does not clear the selection; Clara keeps the last known
  selected sessions.
- If pruning removes every selected ID, the selection bar disappears and the
  Delete/Backspace shortcut becomes a no-op.
- If a selected session is moved between sections by a live update, its selected
  styling follows it.

### Keyboard and pointer

- Shift+Enter on a focused session row behaves exactly like shift-click: it
  extends the selection and does not navigate. Normal Enter keeps the link's
  current navigation behavior.
- Delete and Backspace open the confirmation dialog only when all of the
  following are true:
  - the selection is non-empty;
  - focus is not in an input, textarea, select, or contenteditable element;
  - no Ctrl, Meta, or Alt modifier is held;
  - the event is not an auto-repeat or IME composition;
  - no Clara dialog, menu, popover, select, or sheet is open, except for the
    drawer's own sheet when the drawer instance is the active surface;
  - no deletion is in progress.
- The open-modal guard includes `[data-slot="sheet-content"]` as well as the
  existing dialog, dropdown-menu, select, and popover content slots. An open
  mobile drawer blocks the hidden desktop sidebar. The drawer instance may handle
  the shortcut inside its own open sheet so a hardware keyboard remains usable
  there.
- The handler calls `preventDefault` only when it is about to open the dialog, so
  Backspace cannot trigger browser history navigation in that case.
- The shortcut listens only from the visible sidebar surface. The desktop
  instance is active only while `(min-width: 768px)` matches and no modal sheet
  is open. It re-checks the viewport at event time or subscribes to the media
  query change; a resize that hides the desktop sidebar must make it inert even
  though the component remains mounted.
- The drawer instance is active only while its own sheet is open. Closing the
  drawer clears its selection so a hidden drawer cannot retain a destructive
  target.
- The Delete action in the selection bar opens the same dialog. It is hidden
  when the selection is empty, so the resting UI has no bulk control.
- Middle-click and modified normal clicks retain browser behavior and do not
  change the selection.

### Selection bar

- It renders only while at least one session is selected, between the search row
  and the scrollable session list.
- It shows:
  - a visible count using the configured session noun;
  - the hint “Press Delete or Backspace to delete”;
  - a Clear button;
  - a destructive Delete button.
- After a partial failure it keeps the failed count and shows a short persistent
  note. The note is singular-aware:
  - one failure: “Could not delete 1 brief. It is still selected.”
  - multiple failures: “Could not delete 2 briefs. They are still selected.”
  - use the configured noun in place of “brief”.
- The failure note clears when the selection changes, when pruning removes
  selected IDs, when Clear is used, and when the project or search changes.
- On viewports below `md`, Clear and Delete each present at least a 44×44 CSS
  pixel hit area with at least 8px between them. Their labels remain readable and
  the count/hint block remains visible. Desktop keeps the compact button size.
- The count and failure note are announced through one polite live region. Do
  not nest a second live region inside it.
- Closing the mobile navigation drawer clears the selection.

### Selected row styling

- Selected rows use a clearly distinct background plus a border or ring so the
  state remains readable on hover and focus.
- The existing active-session dot, unread weight, snooze icon, and error/plan
  indicators remain intact.
- Focus-visible rings remain visible on selected rows.
- No checkbox is added to rows.

### Confirmation dialog

- Reuse the existing shadcn `Dialog`, `DialogHeader`, `DialogTitle`,
  `DialogDescription`, and `DialogFooter` conventions.
- The dialog captures a snapshot of the selected sessions when it opens. List
  updates behind it do not change the target set.
- The snapshot is retained through dismissal. Closing sets only the dialog's
  open state to false; it does not replace the snapshot with `null` or an empty
  array. The snapshot is replaced only when the dialog opens again or the
  sidebar unmounts.
- While the close animation runs, the title, description, and confirm label are
  derived from the retained snapshot. The UI must never render “Delete 0 …” or
  an empty title during dismissal.
- If the snapshot is unexpectedly empty, the dialog content is not rendered at
  all. It must not render a zero-count confirmation.
- Title:
  - one session: `Delete this {lowerSingular}?`
  - multiple: `Delete {count} {lowerPlural}?`
- Description states the exact count, says all messages are permanently removed
  from the OpenCode server, and says the action cannot be undone.
- The destructive action is labelled
  `Delete {lowerSingular}` or `Delete {count} {lowerPlural}` and uses the
  destructive button variant.
- Cancel is a normal outline button and receives initial focus, so an accidental
  Enter cancels rather than deletes.
- Escape, Cancel, the close control, and clicking outside dismiss without any
  write.
- While deleting:
  - the destructive action shows a spinner and “Deleting…”;
  - both actions are disabled;
  - the close control is hidden;
  - Escape and outside clicks do not dismiss the dialog.
- On completion the dialog closes before the result toast is shown.

### Deletion and results

- OpenCode has no bulk delete endpoint. Clara calls the existing
  `client.session.remove({ sessionID })` once per selected session.
- Writes run four at a time, matching the project bulk-action concurrency limit.
  The implementation must not reuse the fail-fast helper; it must continue after
  an individual failure.
- A successful delete removes that session from the selection. A failed delete
  keeps that session selected.
- If every write succeeds:
  - close the dialog;
  - clear the selection and anchor;
  - invalidate the session list queries;
  - show `Deleted 1 {lowerSingular}` or `Deleted N {lowerPlural}` after the
    dialog has closed.
- If some writes fail:
  - close the dialog;
  - set the selection to exactly the failed IDs and set the anchor to the first
    failed row in full display order;
  - invalidate the session list queries;
  - show one error toast after the dialog has closed;
  - keep the failed rows visibly selected and show the persistent note in the
    selection bar.
- If every write fails:
  - keep every session selected and use the same error reporting path;
  - do not say “Deleted 0 …”. The toast title is
    `Could not delete 1 {lowerSingular}` or
    `Could not delete N {lowerPlural}`.
- Partial-failure toast titles use the configured noun and singular/plural
  correctly:
  - some deleted, some failed:
    `Deleted {deleted} {deletedNoun} and failed to delete {failed} {failedNoun}`;
  - none deleted, some failed:
    `Could not delete {failed} {failedNoun}`.
- The error toast description lists failed session titles. Use
  `Untitled {lowerSingular}` for blank titles. List at most three names and
  append “and N more” when needed.
- The dialog closes before any success or error toast is shown. Keep the pending
  result until the close callback or the next animation frame, then show it once.
  Do not show a toast while the dialog is still open.
- If the selected set is empty by the time confirmation runs, close the dialog,
  clear the selection, and show an informational toast instead of writing:
  `Select {lowerPlural} to delete.`
- If the currently open session was successfully deleted, navigate to the
  project page (`/p/{projectID}`) after the dialog closes and the toast is
  queued. If it failed, stay on the chat view.
- If the mutation itself rejects outside the per-session failure path, close the
  dialog, keep the target selection, and show a generic error after the close.
- Invalidate `['sessions']` once after the batch settles. Also invalidate the
  individual session query for each successful deletion, matching the existing
  single-delete behavior. The existing `session.deleted` event invalidation and
  chat-store cleanup remain in place.

### Focus management

- Capture the element that had focus when the dialog opens.
- Prevent the dialog primitive's default close auto-focus. Schedule focus after
  the dialog has closed and, for a successful delete, after the list refresh has
  settled.
- On dismissal (Escape, Cancel, close, outside click):
  - focus the captured row link if it is still connected;
  - if the captured element is the destructive Delete trigger, is no longer
    connected, or is not a row, focus the first selected row in full display
    order;
  - if no selected row is rendered, focus the selection bar's Clear control;
  - if Clear is not available, focus the search field;
  - never focus the destructive Delete trigger.
- On partial failure, focus the first failed row in current rendered order, then
  Clear, then the search field.
- On success, compute the focus target from the pre-deletion snapshot:
  - `beforeOrder` is the full session display order captured synchronously when
    the confirmation starts, including collapsed sections.
  - `afterOrder` is the rendered session order after the successful refresh.
  - `deletedIDs` is the set returned by the delete hook.
  - Find the first and last deleted positions in `beforeOrder`. Scan forward
    from the last deleted position for the first ID that is not deleted and is
    present in `afterOrder`. If none, scan backward from the first deleted
    position. If none, return `null`.
  - Focus the returned row. When the helper returns `null`, focus the search
    field.
- The focus helper is pure and tested. It must not read the DOM or React state.

### Accessibility

- The selection count is exposed through a `role="status"` /
  `aria-live="polite"` text region so shift-click, pruning, and partial failures
  are announced without moving focus.
- Each selected session link includes a visually hidden “Selected for deletion”
  phrase in its accessible name. `aria-selected` is not used on a link.
- The row link exposes `aria-keyshortcuts="Shift+Enter"`.
- The dialog uses `DialogTitle` and `DialogDescription` so it is announced as a
  named modal with a description.
- On dismissal, focus returns to a row or Clear as described above, never to the
  destructive trigger.
- On success, focus moves to a surviving row using the pre-deletion snapshot, or
  to the search field when no surviving row can receive it. On partial failure,
  focus moves to the first failed selected row, then Clear.
- The conditional Delete action is reachable by Tab and has an explicit
  accessible label.
- The mobile selection bar's Clear and Delete controls remain reachable by touch
  and keyboard with their 44px hit areas.

## Edge cases

| Scenario                                      | Behavior                                                                    |
| --------------------------------------------- | --------------------------------------------------------------------------- |
| First shift-click, no anchor                  | Select the clicked row and make it the anchor.                              |
| Reverse range                                 | Select the same inclusive rows regardless of click direction.              |
| Range crosses sections                        | Follow rendered section order, then per-section order.                      |
| Range crosses closed sections                 | Skip rows in collapsed sections; select only rendered rows.                 |
| Selection spans Workers                       | Include workers and delete them like ordinary sessions.                     |
| Selected row reorders after a live update     | Stay selected by ID and follow the new position.                            |
| Selected session disappears elsewhere         | Prune it on the next successful refresh; update the count.                  |
| Anchor disappears                             | Keep the remaining selection; the next shift-click starts a new anchor.     |
| Prune removes selected IDs                    | Clear the failure note as well as the missing IDs.                          |
| List refetch fails                            | Keep the selection and the last known count.                                |
| Search changes                                | Clear the selection, anchor, and failure note.                              |
| Project changes                               | Clear the selection, anchor, and failure note; dismiss an idle dialog.       |
| Focus in search, composer, or contenteditable | Delete/Backspace are ignored.                                               |
| Ctrl/Meta/Alt + Delete                        | Ignored.                                                                    |
| Key auto-repeat                               | Ignored.                                                                    |
| Empty selection                               | Delete/Backspace do nothing and no dialog opens.                            |
| Any dialog, menu, popover, select, or sheet   | Delete/Backspace do not open a second dialog; the drawer's own sheet is the exception for the drawer instance. |
| Desktop sidebar hidden by resize              | It becomes inert immediately; its stale selection cannot open a dialog.     |
| Mobile drawer open                            | The desktop sidebar stays inert; the drawer owns its selection.             |
| Escape, Cancel, close, outside click          | Dismiss without writing; focus goes to a row or Clear, not Delete.          |
| Confirm clicked repeatedly                    | Disabled after the first activation; only one batch runs.                   |
| Dialog closing after confirm                  | The retained snapshot keeps the last count; no “Delete 0 …” flash.          |
| Result toast timing                           | The dialog closes first; the toast appears after the close.                 |
| Partial failure                               | Continue remaining writes; report failed titles; keep failures selected.    |
| All writes fail                               | Keep all selected and show `Could not delete …`, never `Deleted 0 …`.       |
| One write fails                               | Use singular wording in the note and toast.                                 |
| Current open session deleted                  | Route to the project page after success.                                    |
| Current open session fails                    | Stay on its chat view.                                                      |
| More than three failures                      | Toast names the first three and “and N more”.                               |
| Success with surviving rows                   | Focus a surviving row chosen from the pre-deletion snapshot.                |
| Success removes every row                     | Focus the search field.                                                     |
| Custom session noun                           | Every label, status, dialog, and toast uses the configured wording.         |
| Mobile drawer closes with a selection         | Clear the selection.                                                        |
| Touch-only device                             | Selection is offered through shift-equivalent actions only where available; no long-press mode is added. |

## Non-goals

- Multi-select on the project page session cards or elsewhere in the app.
- Changing the existing single-session delete in the chat header or the empty
  draft's immediate Delete action.
- Bulk archive, snooze, reopen, fork, move, or tag.
- Additive, discontiguous, Ctrl/Cmd-click, select-all, or drag selection.
- Arrow-key roving focus or a dedicated selection mode.
- Touch long-press selection.
- Checkboxes, a permanent bulk toolbar, or a row-level delete icon at rest.
- Cross-project selection.
- Undo, a trash bin, or soft deletion.
- A server-side bulk delete endpoint or any wire/schema change.
- Persisting selection across reloads, tabs, or devices.
- Changing the 50-session list cap.
- Adding a DOM test dependency such as Testing Library or jsdom solely for this
  change.

## Constraints

- Session rows are React Router `Link`s. Normal activation must keep navigating.
  Shift-click and Shift+Enter must prevent the link's default action.
- Use existing shadcn `Dialog` and `Button` components, `sonner` toasts,
  `useSessionWording`, `isTextEntryTarget`, query keys, and the existing
  `client.session.remove` call.
- Do not introduce a new dependency, a checkbox UI component, or a server API.
- Keep the resting sidebar visually clean and keep the implementation focused to
  the session list.
- Use type-only imports and avoid `any`.
- Existing session wording, toast, query invalidation, and delete behavior stay
  consistent with the rest of Clara.
- The open-modal guard must inspect the document for the established `data-slot`
  markers, including `sheet-content`.
- The desktop keyboard listener must re-check viewport visibility rather than
  relying only on the media query state captured when the effect mounted.

## Data and API changes

No wire, server, or schema change.

### New pure focus helper

Add `apps/web/src/features/sessions/delete-focus.ts`:

```ts
export function resolveDeleteFocusTarget(
  beforeOrder: readonly string[],
  afterOrder: readonly string[],
  deletedIDs: ReadonlySet<string>
): string | null
```

It returns the first surviving row after the deleted range in the pre-deletion
order, then the first surviving row before the range, then `null`. A row counts
as surviving only when it is not in `deletedIDs` and is present in `afterOrder`.
`beforeOrder` is captured before the mutation; `afterOrder` is the rendered list
after the successful refresh. The helper is pure and has no DOM access.

### Selection helpers

`apps/web/src/features/sessions/session-selection.ts` keeps:

```ts
type SelectionState = {
  anchorID: string | null
  selectedIDs: ReadonlySet<string>
}

function selectRange(
  orderedIDs: readonly string[],
  anchorID: string | null,
  targetID: string
): SelectionState

function pruneSelection(
  selection: SelectionState,
  availableIDs: ReadonlySet<string>
): SelectionState
```

`selectRange` returns the inclusive range, or only the target when the anchor is
missing. `pruneSelection` drops unavailable IDs and drops the anchor when it is
no longer available.

The sidebar owns the state and actions:

```ts
select(id) // normal click: clear, set anchor, navigate
extendTo(id) // shift-click or Shift+Enter: range from the anchor
clear() // Clear button or successful batch
prune(ids) // after a successful list refresh; also clears the failure note
```

No storage key is added.

### Bulk delete hook and copy

Keep `apps/web/src/features/sessions/use-delete-sessions.ts` with:

```ts
type DeleteSessionsResult = {
  deleted: string[]
  failed: Array<{ session: SessionInfo; error: unknown }>
}

useDeleteSessions(): UseMutationResult<
  DeleteSessionsResult,
  never,
  readonly SessionInfo[]
>
```

The mutation accepts the snapshot of selected sessions, runs one
`session.remove` per item with concurrency four, catches per-session failures,
and resolves the result instead of rejecting for partial failure. It invalidates
`['sessions']` after the batch and invalidates each deleted session's query.

Add a pure result-copy helper in the same module:

```ts
type DeleteOutcomeCopy = {
  tone: 'success' | 'error'
  title: string
  description?: string
}

function describeDeleteOutcome(
  result: DeleteSessionsResult,
  wording: { lowerSingular: string; lowerPlural: string }
): DeleteOutcomeCopy | null
```

It returns `null` for an empty result, success copy with singular/plural noun
agreement, partial-failure copy with singular/plural agreement for both counts,
and all-failure copy that never says “Deleted 0 …”. The component uses it so
wording is testable without DOM assertions.

### Concurrency helper

`apps/web/src/lib/concurrency.ts` keeps the result-collecting companion to
`runWithConcurrency`:

```ts
type SettledResult<T, R> =
  | { item: T; status: 'fulfilled'; value: R }
  | { item: T; status: 'rejected'; reason: unknown }

runWithConcurrencySettled<T, R>(
  items: readonly T[],
  concurrency: number,
  task: (item: T) => Promise<R>
): Promise<SettledResult<T, R>[]>
```

It preserves input order. The existing fail-fast `runWithConcurrency` and the
project bulk actions are unchanged.

### Components

- `sidebar.tsx` owns selection state, the retained dialog snapshot, the pending
  result copy, the keyboard listener, and the focus intent.
- `sidebar-session-row.tsx` gains selected state, shift-click handling,
  Shift+Enter handling, selected styling, and screen-reader text.
- `sidebar-selection-bar.tsx` renders the count, hint, failure note, Clear, and
  Delete controls, including the 44px mobile hit areas.
- `sidebar-delete-dialog.tsx` renders from the retained snapshot. It does not
  derive its count from a value that can become empty during the close
  animation.
- The existing `session.deleted` event handler continues to invalidate
  `['sessions']`, forget deleted chat state, and invalidate the individual
  session query.

## Documentation updates

- `docs/features/sessions.md`: add the selection and delete flow, expand core
  rule 12, document the retained dialog snapshot, focus restoration, failure-note
  pruning, and mobile hit areas; add edge cases and update the out-of-scope
  bullet that currently rules out all bulk actions.
- `docs/features/shortcuts.md`: add Shift+Enter, Delete, and Backspace to the
  user flow, rules, edge cases, and shortcut table, including the text-field,
  modal, sheet, and hidden-desktop-sidebar guards.
- `docs/features/capabilities.md`: extend the Sessions row to state that
  shift-click range selection and explicit multi-session deletion with
  per-session failure reporting ship, with no resting bulk controls.
- `spec.md` remains the request-level artifact and is not added to the feature
  docs index.

## Acceptance criteria

1. The resting sidebar has no checkbox, selection bar, bulk toolbar, or row
   delete control.
2. A normal click still opens the session and clears the selection.
3. Shift-click selects the inclusive rendered range from the anchor, works in
   both directions and across sections, and never navigates.
4. Shift+Enter on a focused row produces the same selection result without
   navigation.
5. The selection bar shows the correct count, selected styling is visible, and
   Clear removes the selection and failure note.
6. Delete and Backspace open the dialog only with a non-empty selection and
   never from a text-entry target, while a dialog/menu/popover/select/sheet is
   open, or while deletion is running.
7. The mobile drawer's sheet blocks the hidden desktop sidebar; the drawer may
   handle the shortcut only inside its own open sheet. A resize below `md`
   makes the desktop instance inert immediately.
8. The dialog states the count and permanence, focuses Cancel initially, and
   dismisses without deletion on Escape, Cancel, close, or outside click.
9. The dialog retains its last snapshot through dismissal and never renders
   “Delete 0 …” or an empty title.
10. Confirming deletes exactly the snapshotted selection, shows a busy state, and
    cannot be double-submitted.
11. Partial and total failures continue the batch, report failed titles, keep
    failures selected, and use singular/plural wording correctly.
12. The result toast appears only after the dialog closes.
13. Dismissal focus returns to a row or Clear, never to the destructive trigger.
14. Success focus uses the pre-deletion snapshot and lands on a surviving row
    whenever one exists; it falls back to search only when none does.
15. Selection survives reorder and background refresh, is pruned when sessions
    disappear, clears on project or search change, and clears the failure note
    when pruned.
16. Deleting the open session routes to the project page; a failed open session
    stays open.
17. Screen readers announce the count, expose selected rows, and announce the
    dialog title and description.
18. The custom session noun is used everywhere.
19. Clear and Delete have at least 44×44 mobile hit areas.
20. Source-grep assertions labeled as acceptance tests are removed; behavioral
    tests cover selection, focus targeting, concurrency, deletion results,
    invalidation, and copy.
21. The docs and capabilities entry are updated.
22. `pnpm check` and `pnpm build` pass.
23. The verification record states what was exercised against a live server,
    keyboard-only, and a screen reader, and what could not be exercised.

## Test plan

### Automated behavioral tests

Using the existing Vitest setup and pure helpers:

- `selectRange`: forward range, reverse range, anchor equals target, missing
  anchor, missing target, and section-order input.
- `pruneSelection`: keeps available IDs, drops removed IDs, drops a missing
  anchor, and returns an empty selection when nothing remains.
- `resolveDeleteFocusTarget`: middle deletion, deletion at the end falls back to
  the previous row, deletion at the start, consecutive and non-contiguous
  deletions, survivors removed from `afterOrder`, reordered `afterOrder`, new
  rows not present in `beforeOrder`, all rows deleted, empty `beforeOrder`, and
  deleted IDs absent from `beforeOrder`. Assert that a surviving row is chosen
  before returning `null`.
- `runWithConcurrencySettled`: preserves input order, never exceeds the
  concurrency cap, collects mixed fulfilled/rejected results, and handles an
  empty list.
- `deleteSessions`: continues after a rejection, returns the correct deleted and
  failed sets, calls `remove` once per session with the session ID, caps at four
  concurrent writes, and handles an empty list.
- `invalidateDeletedSessions`: invalidates the list once, invalidates only
  successful individual session queries, and ignores failed IDs.
- `describeFailedSessions`: blank titles, a custom noun, one name, two names,
  three names, and more-than-three with “and N more”.
- `describeDeleteOutcome`: success singular/plural, partial failure with singular
  and plural deleted/failed counts, all-failure singular/plural, and empty
  result.

### Removed source-grep tests

- Delete `apps/web/src/features/sessions/multi-session-delete.acceptance.test.ts`.
  Do not replace it with another file that reads source files or documentation
  and asserts substrings.
- Do not label grep-style assertions as acceptance tests. Behavioral coverage is
  the unit and helper tests above; lifecycle and accessibility behavior is
  covered by the manual verification record.
- Do not add Testing Library or jsdom for this change; the existing test setup
  supports pure logic, hook-level tests, and server-rendered markup only.

### Manual verification

Against a live OpenCode 2.1.x server through the affected transport where
available:

- Shift-click forward, backward, across sections, and across an expanded Workers
  section.
- Collapse a section around a selection and confirm the count, styling, and
  delete behavior.
- Let a session update or move sections while selected.
- Delete a selected session from another client and confirm pruning clears the
  failure note.
- Search while selected, change project, and navigate between sessions.
- Press Delete and Backspace from the list, search field, composer, and a
  contenteditable message.
- Press Delete/Backspace with a dialog, menu, popover, select, and mobile drawer
  open; confirm only the intended surface responds.
- Resize across the `md` breakpoint with a selection in the desktop sidebar and
  confirm the hidden instance cannot open a dialog.
- Cancel with Escape, Cancel, close, and outside click; confirm focus returns to a
  row or Clear and never to the Delete trigger.
- Confirm a successful delete in the middle of the list, at the end, and as the
  entire list; confirm focus lands on the expected row or search field.
- Confirm partial and total failures; verify singular/plural copy, retained
  selection, failure note, and retry.
- Confirm the dialog does not flash a zero count during its close animation and
  that the toast appears after the dialog closes.
- Verify keyboard-only operation and a screen reader announcement of the count,
  selected rows, and dialog.
- Verify the mobile drawer clears selection on close and that Clear/Delete have
  44×44 hit areas.

### Verification record

The delivery must include a short record with the environment and the outcome
for each row below. A check may be marked “Not exercised” with a reason when the
environment cannot support it. Source inspection, unit tests, or a passing build
do not count as live-server, keyboard-only, or screen-reader verification.

| Check                     | Required evidence                                                        | Status                  |
| ------------------------- | ------------------------------------------------------------------------ | ----------------------- |
| Live OpenCode 2.1.x       | Server version, transport/mode, and the delete flows exercised            | Pending in this revision |
| Keyboard-only             | Tab order, Shift+Enter, Delete/Backspace, Escape, and focus restoration   | Pending in this revision |
| Screen reader             | VoiceOver, NVDA, or Orca announcement of count, rows, and dialog          | Pending in this revision |
| Mobile drawer and resize  | Drawer close, 44px targets, hidden desktop instance inert after resize    | Pending in this revision |
| Automated gates           | `pnpm check` and `pnpm build` output                                     | Pending in this revision |

## Delivery

- Preserve the existing uncommitted implementation and move it into a task
  worktree created with `pnpm task session start multi-session-delete --base
  main`; do not re-implement from scratch.
- Keep this record at `docs/records/002-multi-session-delete.md`. It is
  append-only and unindexed, so do not add it to `docs/README.md`.
- Commit on `task/multi-session-delete` with coherent Conventional Commits, each
  carrying the OpenCode and DeepSeek V4.1 Flash co-author trailers. Merge into
  `main` only through the task worktree.
- Run `pnpm check` and `pnpm build` before closing. Merge only on a passing
  `pnpm check`.
- Close with `pnpm task session close multi-session-delete`, then verify `main`
  is clean and no task worktree or `task/*` branch remains.
