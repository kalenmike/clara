# Composer

## Summary

The composer is the always-open panel at the bottom of a session. It has three
shapes — pinned, maximized, and minimized — and a tab strip that keeps drafts for
several sessions in reach, with every tab carrying the same live status mark as
its sidebar row. It carries prompts, commands, mentions, attachments,
model and agent selection, waiting question forms, and the plan-ready handoff.

## User flow

1. Open a session. The composer is pinned above the usage bar with a tab for the
   current session. Drag its top edge, use the arrow keys on the handle, or
   double-click the handle to change its height.
2. Type a prompt. Press Enter to steer the active run or Shift+Enter for a new
   line; on touch devices Enter adds a line and Send submits. Type `/` for
   commands and `@` for files, agents, skills, and references. Attach files with
   the paperclip or by pasting them.
3. Open the send menu for **Done**, **Save as draft**, **Send as queued**,
   **Delete empty draft**, or **Reopen**. Done archives an idle session, Save as
   draft keeps a first message without starting a run, and queued sends wait
   behind an active run.
4. Move to another session. The composer follows the session on screen; the
   previous session keeps its tab when it still has text or attachments.
5. Select another tab to edit that session's draft without leaving the chat on
   screen, read its live status mark, press its go-to button to open that
   session, or close the tab to drop the shortcut while keeping the local draft.
6. Expand the composer to fill the screen, or collapse it to the tab strip with
   the leading chevron. The chevron restores the last expanded shape from the
   header, while Expand always goes fullscreen, including from a collapsed
   composer. A minimized tab selection restores the composer before focusing the
   editor.
7. With **Auto-hide the composer** on in Settings, the dock rests as its title
   bar. Pointing at the title bar reveals the last expanded shape, and leaving
   the composer hides it again. The collapse chevron becomes a pin toggle:
   pinning keeps the composer open until the pin is turned off, and turning
   auto-hide off clears the pin.
8. When a question form or plan-ready handoff is waiting, select its card above
   the editor. Send answers it, optionally with a message; a secondary Skip or
   Start button sits beside Send.

## Core business rules

1. The composer has exactly three shapes. **Pinned** is the default dock above
   the usage bar and is resizable from 220px to 720px. **Maximized** is a
   fullscreen panel with no margin or corner radius. **Minimized** shows only the
   tab strip and controls. The leading chevron collapses an expanded composer and
   restores a minimized one to its last expanded shape; the expand control only
   toggles fullscreen and the pinned dock, and targets fullscreen from a
   minimized header. The height persists; the shape resets to pinned on reload.
2. The session on screen always has a highlighted tab and cannot close it, so
   the strip is never empty. Leaving a session keeps its tab only when that
   session's composer has unsent text or attachments. Tabs persist across
   reloads when their local text draft still exists. A closed tab keeps its
   draft; closing is a navigation shortcut, not a delete.
3. Selecting a tab changes the composer's target without moving the chat. The
   current session's tab keeps its highlight; the selected tab is accent-marked
   and keeps its go-to and close controls. Every tab carries the same status mark
   as its sidebar row — snoozed, waiting for input, running, failed, plan ready,
   finished, or idle — so another session's state is visible without opening it.
   A send from another tab targets that tab's session and removes the tab once
   the draft clears.
4. The send chevron holds every action that is not the primary Send. Done is
   available on an idle, non-archived, non-snoozed session with messages and
   archives it without renaming. Delete removes an empty draft; Reopen clears
   the archived or snoozed state. Save as draft appears before the first
   assistant reply, and Send as queued appears while a run is active.
5. Unsent text is stored per session in local storage. Attachments stay with the
   open tab in memory. A successful send clears the editor and keeps the
   composer open; a failed send keeps the text, attachments, and delivery.
6. Waiting requests belong to the composer. The first pending question is
   selected by default, otherwise the plan-ready card. The cards scroll with the
   editor rather than in their own scroller, so a tall form never hides the
   message box. A touched form with a message admits the prompt first with
   resume disabled, then answers the form; an untouched form with a message is
   skipped before sending. A ready plan starts through the secondary Start
   button and ignores typed text, which is sent to the Plan agent as an
   adjustment.
7. **Auto-hide the composer** is a device-local preference. With it on, the dock
   follows the pointer: entering the title bar reveals the last expanded shape,
   and leaving the composer hides it again. Keyboard focus and an open composer
   menu keep it visible. The chevron is replaced by a pin toggle; a pinned
   composer stays open across reloads until the pin is turned off, while
   turning auto-hide off clears the pin. A maximized composer never auto-hides,
   and touch-first devices ignore the preference.

## Edge cases

- **Empty or whitespace-only prompt** — Send, Save as draft, and Send as queued
  are disabled; Done, Delete, and Reopen stay available where they apply.
- **Mobile Enter** — touch keyboards have no Shift key, so Enter always inserts
  a new line; tap Send to submit.
- **Tab strip overflow** — tabs scroll horizontally and titles truncate; controls
  stay on the right.
- **Tall question forms** — the request cards and the editor share one scroll
  region, and the editor keeps a usable minimum height, so scrolling down always
  reaches the message box.
- **Closing tabs** — the current session's tab has no close control. Closing a
  selected tab returns the composer to the session on screen.
- **Attachments only** — an attachment-only tab is kept during the visit but is
  not restored after a reload because attachments are not persisted.
- **Switching tabs with form answers** — answers belong to the mounted composer
  and reset when another tab is selected.
- **Auto-hide while typing or choosing** — focus inside the composer or an open
  model, variant, agent, or send menu keeps it revealed even after the pointer
  leaves. It collapses after focus leaves and no menu is open.
- **Auto-hide with a fullscreen composer** — the maximized shape stays visible;
  docking it again returns it to pointer-driven auto-hide.
- **Auto-hide on a touch device** — the Preferences switch is hidden and a stored
  auto-hide choice is ignored because there is no hover.
- **Pinned across reloads** — the pin is stored with the auto-hide choice.
  Turning auto-hide off clears it so re-enabling starts hidden.
- **Empty draft** — an untitled session with no messages, requests, text, or
  attachments is discarded when the view leaves it.
- **Done on the current session** — archives and returns to the inbox or start
  view. Done on another tab just closes that tab.
- **Save as draft failure** — the tab keeps its text and attachments.
- **Directory deleted** — the send reports the missing workspace folder, moves
  the session to the project's canonical directory, and retries once.
- **Deleted session** — a restored tab whose session no longer loads shows the
  untitled fallback and can be closed unless it is the current session.

## Out of scope

- Drag-and-drop attachment zones
- Reordering, splitting, or dragging tabs
- Scheduling a send for a date or time
- Email-style To/Cc/Bcc recipients
- Rich text, signatures, or quoted replies
- Shell mode (`!`), voice input, or prompt history navigation
- Creating or editing command templates in Clara

## Known gaps

- Only text drafts survive a reload; attachments and form answers are held in
  memory for the visit.
- Saved drafts cannot be edited or cancelled from Clara yet; start the draft or
  delete the session.
- Mentions insert a path string rather than attaching the referenced file.
- A tab's request badge counts pending forms; the ready-plan count is shown for
  the selected tab only, though every tab's orange status mark shows a ready
  plan.

## Technical appendix

<details>
<summary>Routes, data, and references</summary>

- Components: `src/components/chat/composer-panel.tsx`,
  `src/components/chat/composer-tab-strip.tsx`,
  `src/components/chat/composer.tsx`,
  `src/components/chat/composer-request-list.tsx`,
  `src/components/chat/form-fields.tsx`,
  `src/components/sessions/session-status-icon.tsx`
- Layout and tabs: `src/features/chat/composer-layout.ts` owns the three shapes
  and the auto-hide visibility decision,
  `src/features/chat/composer-tabs.ts` owns tab membership, persistence, and the
  close guard, and `src/hooks/use-composer-height.ts` owns the pinned drag and
  keyboard resizing.
- Auto-hide: `src/features/settings/composer-auto-hide.ts` stores the choice and
  pin; `src/features/settings/use-composer-auto-hide.ts` exposes them;
  `src/components/settings/composer-card.tsx` renders the Preferences switch.
- Tab status: `src/features/chat/use-composer-tab-status.ts` reads the active
  map, mailbox signals, and pending permissions for one tab;
  `src/features/sessions/session-status.ts` owns the shared mark precedence and
  labels used by both tabs and sidebar rows.
- State: `src/features/chat/composer-provider.tsx` owns the shape, tab order,
  selected session, per-tab drafts, handoff text and files, focus requests, and
  the sent signal. `src/features/chat/composer-session.ts` holds route targets,
  titles, and return paths.
- Actions: `src/features/chat/composer-actions.ts` decides which send-menu items
  apply; `src/features/chat/composer-menu.ts` still chooses the draft or queue
  alternative.
- Target data: `src/features/chat/use-composer-target.ts` reads the selected
  session's info, snapshot, history, pending drafts, and plan-ready state.
- Send: `client.session.prompt({ sessionID, text, files, delivery })` with
  `delivery: 'steer'`; queue uses the same call with `delivery: 'queue'`;
  commands use `client.session.command`.
- Save as draft: `client.session.prompt({ ..., resume: false })`.
- Done: `client.session.update({ sessionID, archived: true })`; Delete:
  `client.session.remove({ sessionID })`.
- Storage: `clara.draft.<sessionID>` for text, `clara.composerTabs` for the
  ordered session list, `clara.composerHeight` for the pinned height,
  `clara.composerAutoHide` for the auto-hide choice, and `clara.composerPinned`
  for the pin.
- Loaded from: `/p/:projectId/s/:sessionId`
- Related: [chat](chat.md), [sessions](sessions.md), [shortcuts](shortcuts.md)

</details>
