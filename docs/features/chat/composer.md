# Composer

## Summary

The composer is the always-open panel at the bottom of a session. It has three
shapes — pinned, maximized, and minimized — and a tab strip that keeps drafts for
several sessions in reach, with every tab carrying the same live status mark as
its sidebar row. It carries prompts, commands, mentions, attachments, model and
agent selection, waiting question forms, and the plan-ready handoff.

## User flow

1. Open a session. The composer is docked at the bottom of the thread with a tab
   for the current session. Drag its top edge, use the arrow keys on the handle,
   or double-click the handle to change its height.
2. Type a prompt and press Enter to steer the active run, or Shift+Enter for a
   new line. Type `/` for commands and `@` for files, agents, skills, and
   references. Attach files with the paperclip or by pasting them.
3. Open the send menu for **Start work**, **Done**, **Save as draft**, **Send as
   queued**, **Delete empty draft**, or **Reopen**. Start work hands a finished
   plan to the working agent, Done archives an idle session, Save as draft keeps
   a first message without starting a run, and a queued send waits behind an
   active run.
4. Move to another session. The composer follows the session on screen; the
   previous session keeps its tab when it still has text or attachments.
5. Select another tab to edit that session's draft without leaving the chat on
   screen, read its live status mark, press its go-to button to open that
   session, or close the tab to drop the shortcut while keeping the local draft.
6. Expand the composer to fill the screen, or collapse it to the tab strip with
   the leading chevron. The chevron restores the last expanded shape, while
   Expand always goes fullscreen, including from a collapsed composer. Selecting
   a tab while minimized restores the composer before focusing the editor.
7. With **Auto-hide the composer** on in Settings, the dock rests as its title
   bar. Pointing at the composer reveals the last expanded shape, and leaving it
   hides the composer again. The collapse chevron becomes a pin toggle.
8. When a question form is waiting, select its card above the editor. Send
   answers it, optionally with a message; a secondary Skip button sits beside
   Send. When a finished plan is waiting, the send menu offers Start work instead
   of a card. See [approvals.md](approvals.md).

## Core business rules

1. The composer has exactly three shapes. **Pinned** is the default dock at the
   bottom of the thread and resizes from 220px to 720px. **Maximized** is a
   fullscreen panel with no margin or corner radius. **Minimized** shows only the
   tab strip and controls. The leading chevron collapses an expanded composer and
   restores a minimized one to its last expanded shape; the expand control only
   toggles fullscreen and the pinned dock. The height persists, but the shape
   resets to pinned on reload, and reduced-motion users get the change without
   animation.
2. The session on screen always has a highlighted tab and cannot close it, so the
   strip is never empty. Leaving a session keeps its tab only when that session's
   composer still has unsent text or attachments, and tabs persist across reloads
   while their local text draft exists. A closed tab keeps its draft, because
   closing is a navigation shortcut rather than a delete. Selecting a tab changes
   the composer's target without moving the chat, and a send from another tab
   targets that tab's session and removes it once the draft clears.
3. Every tab carries the same status mark as its sidebar row — snoozed, waiting
   for input, running, failed, plan ready, finished, or idle — so another
   session's state is visible without opening it. See
   [sessions](../sessions/index.md) for the shared mark precedence.
4. The send chevron holds every action that is not the primary Send. Start work
   appears while a finished plan waits and no question form is pending; it
   switches to the working agent, and a typed message becomes the first Build
   prompt. Done is available on an idle, non-archived, non-snoozed session with
   messages and archives it without renaming. Delete removes an empty draft,
   Reopen clears the archived or snoozed state, Save as draft appears before the
   first assistant reply, and Send as queued appears while a run is active.
5. Unsent text is stored per session in local storage and attachments stay with
   the open tab in memory. The model and variant pickers sit on the composer's
   **To** row, the agent picker sits in the footer, and Tab cycles agents. A
   successful send clears the editor; a failed send keeps the text, attachments,
   and delivery so it can be retried. A hidden stored model shows **Pick a
   visible model** and blocks sending until a visible one is chosen.
6. **Auto-hide the composer** is a device-local preference. With it on, the dock
   follows the pointer: entering reveals the last expanded shape and leaving
   hides it again. The pointer holds it open while it rests on a select or menu
   that the composer opened and that renders outside the panel, and the dock
   rests once that popup closes and the pointer is away. Keyboard focus and a
   send never hold it open. The chevron becomes a pin toggle; a pinned composer
   stays open across reloads until the pin is turned off, while turning auto-hide
   off clears the pin. A maximized composer never auto-hides, and touch-first
   devices ignore the preference.

## Edge cases

- **Empty or whitespace-only prompt** — Send, Save as draft, and Send as queued
  are disabled; Done, Delete, and Reopen stay available where they apply.
- **Mobile Enter** — touch keyboards have no Shift key, so Enter inserts a new
  line and Send submits.
- **Tab strip overflow** — tabs scroll horizontally and titles truncate; the go-to
  and close controls stay on the right.
- **Tall question forms** — request cards and the editor share one scroll region
  with a usable editor minimum, so scrolling down always reaches the message box.
- **Closing tabs** — the current session's tab has no close control; closing a
  selected tab returns the composer to the session on screen.
- **Attachments only** — an attachment-only tab is kept during the visit but not
  restored after a reload because attachments are not persisted.
- **Switching tabs with form answers** — answers belong to the mounted composer
  and reset when another tab is selected.
- **Auto-hide while typing or choosing** — the draft and form answers are kept;
  pointing at the composer again restores the last expanded shape.
- **Auto-hide on a touch device** — the Preferences switch is hidden and a stored
  auto-hide choice is ignored because there is no hover.
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
  the selected tab only, though every tab's status mark shows a ready plan.

## Technical appendix

<details>
<summary>Routes, data, and references</summary>

- Components: `composer-panel.tsx`, `composer-tab-strip.tsx`, `composer.tsx`,
  `composer-request-list.tsx`, `model-picker.tsx`, and `agent-picker.tsx`
- Layout and tabs: `src/features/chat/composer-layout.ts` owns the three shapes
  and auto-hide; `composer-tabs.ts` owns membership, persistence, and the guard
- Auto-hide: `src/features/settings/composer-auto-hide.ts` stores the choice and
  pin; `use-composer-menu-open.ts` detects an open composer popup
- Tab status: `src/features/chat/use-composer-tab-status.ts` reads the active
  map, mailbox signals, and pending permissions per tab
- State: `src/features/chat/composer-provider.tsx` owns shape, tab order,
  selected session, drafts, handoff text and files, and focus requests
- Actions: `src/features/chat/composer-actions.ts` decides send-menu items;
  send is `client.session.prompt({ ..., delivery: 'steer' })`, queue uses
  `delivery: 'queue'`, and Save as draft uses `resume: false`
- Storage: `clara.draft.<sessionID>`, `clara.composerTabs`,
  `clara.composerHeight`, `clara.composerAutoHide`, `clara.composerPinned`
- Related: [chat](index.md), [approvals](approvals.md), [connection](../connection.md)

</details>
