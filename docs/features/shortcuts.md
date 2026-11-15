# Shortcuts

## Summary

Clara mirrors the OpenCode keyboard model so people can drive sessions without
reaching for the mouse. A leader key covers session, model, agent, and info
actions; direct keys handle interruption and switching.

## User flow

1. Press `ctrl+x` (the leader) with focus outside a text field. Clara waits two
   seconds for the next key.
2. Press `n` to create a session and focus its composer tab, `l` for the project
   session list, `s` to toggle the panel on its Info tab, `g` to open the Git
   tab, or `` ` `` to open the pair terminal.
3. Press `m` for the model picker or `a` for the agent picker. Both restore the
   composer first if it is minimized.
4. Press `c` to compact the context, `y` to copy the last reply, `h` to fold or
   open every message, or `t` to toggle light and dark mode without changing the
   selected color theme.
5. Press Tab or Shift+Tab in the message box to cycle agents without leaving it,
   or use `ctrl+.` / `ctrl+shift+.` anywhere on the chat page.
6. Press `ctrl+t` to cycle the current model's variants.
7. Press Escape to interrupt a running agent or close an open menu or dialog.
8. In the sidebar, Shift+Enter on a focused session extends the selection from
   the anchor; Delete or Backspace opens the multi-session delete dialog.

## Core business rules

1. The leader is `ctrl+x` and expires after 2 seconds. It only starts when
   focus is outside a text field.
2. Shortcuts do not fire while typing in an input, textarea, or contenteditable
   element, except agent cycling (`ctrl+.`, Tab in the message box), `ctrl+t`,
   and Escape. The leader is not available there, so `ctrl+x` keeps its native
   cut behavior.
3. Tab cycles agents while the message box has focus and keeps focus there
   instead of indenting. Tab elsewhere is normal focus traversal, and `ctrl+.`
   cycles agents from anywhere on the chat page.
4. Escape is always offered to the active menu first; when a reply is in part
   selection mode it cancels that instead, and the global handler only
   interrupts when neither consumes it.
5. Shortcuts act on the selected session and project; they do nothing when the
   action has no target.
6. In the sidebar, Shift+Enter extends a session selection from the anchor, and
   Delete or Backspace opens the delete confirmation only when the selection is
   non-empty. Both are ignored inside inputs, textareas, selects,
   contenteditable text, open Clara dialogs, menus, popovers, or sheets, and
   while a deletion runs; the composer keeps Shift+Enter as a newline. Delete
   and Backspace call `preventDefault` so Backspace cannot navigate browser
   history. Only the visible sidebar surface listens: the desktop instance is
   inert below `md` and while the drawer is open, and the drawer responds only
   inside its own open sheet.

## Edge cases

- **Leader pressed alone** — the sequence expires silently after two seconds.
- **Caret in a text field** — `ctrl+x` cuts the selection, or does nothing when
  there is no selection, and never starts the leader. A leader armed before
  focus moved into the field is dropped on the next key press.
- **Leader then unknown key** — nothing happens; the leader resets.
- **No project selected** — `n` and `l` are no-ops.
- **No model variants** — `ctrl+t` is a no-op.
- **Running agent** — Escape interrupts; when idle it does nothing.
- **Menu open in the composer** — Escape closes the menu first, and Tab
  selects the highlighted item instead of cycling agents.
- **Browser-reserved keys** — the browser may intercept combinations such as
  `ctrl+t` before Clara sees them, depending on platform and focus. Clara leaves
  `ctrl+x` to the browser while a text field has focus.
- **Dialog open** — Escape closes the dialog instead of interrupting the run.
- **Part selection active** — Escape cancels the selection and leaves the run
  alone, even while the agent is working.
- **Shift+Enter in the composer** — inserts a newline; range selection applies
  only to a focused sidebar session row.
- **Delete or Backspace while typing** — the sidebar shortcut is ignored so the
  field keeps its native editing behavior.
- **Delete or Backspace with no selection** — nothing happens and no dialog
  opens; an open dialog or menu consumes the key first.
- **Delete or Backspace during deletion** — ignored while the confirmation
  dialog is busy.
- **Viewport below `md` with a desktop selection** — the desktop instance is
  inert; the mobile drawer owns its own selection.

## Out of scope

- User-customizable keybindings
- A which-key overlay or shortcut editor
- Vim or Emacs modal editing
- Shortcuts for staging, commits, revert, or worktrees

## Known gaps

- `ctrl+t` is also the browser's "new tab" shortcut and may not reach Clara in
  some browsers.
- Escape can both close a menu and interrupt a run when focus is outside the
  composer; the global handler is intentionally permissive.
- The theme shortcut toggles between light and dark, keeps the selected color
  theme, and does not cycle through "system".
- Tab and Shift+Tab cycle agents inside the message box, so the textarea cannot
  be left with Tab; click elsewhere to move focus.
- Settings lists the shortcut table only on devices with a fine primary pointer.
  A touch device with an attached hardware keyboard can still use the shortcuts,
  but the reference card stays hidden.

## Technical appendix

<details>
<summary>Routes, data, and references</summary>

| Keys                      | Action                                                     |
| ------------------------- | ---------------------------------------------------------- |
| `ctrl+x` `n`              | New session                                                |
| `ctrl+x` `l`              | Project session list                                       |
| `ctrl+x` `m`              | Model picker                                               |
| `ctrl+x` `a`              | Agent picker                                               |
| `ctrl+x` `c`              | Compact context                                            |
| `ctrl+x` `s`              | Toggle panel (Info tab)                                    |
| `ctrl+x` `g`              | Open panel on Git tab                                      |
| `ctrl+x` `` ` ``          | Toggle pair terminal                                       |
| `ctrl+x` `h`              | Collapse messages                                          |
| `ctrl+x` `t`              | Toggle light/dark mode                                     |
| `ctrl+x` `y`              | Copy last reply                                            |
| `tab` / `shift+tab`       | Cycle agent in the message box                             |
| `ctrl+.` / `ctrl+shift+.` | Cycle agent from anywhere                                  |
| `ctrl+t`                  | Cycle model variant                                        |
| `escape`                  | Interrupt, close, or cancel                                |
| `shift+enter`             | Newline in the composer; extend the selected sidebar range |
| `delete` / `backspace`    | Open bulk delete for selected sidebar sessions             |

`ctrl+x` only starts the leader when focus is outside a text field; inside one
it stays the browser's cut. On touch devices Enter inserts a newline because
those keyboards have no Shift key, and the composer's Send button submits. In
the sidebar, Shift+Enter extends the range from the anchor; Delete and Backspace
open the confirmation only outside text-entry targets and open Clara dialogs.

- Hook: `src/hooks/use-keybinds.ts`
- Text-field check: `src/lib/keyboard.ts` (`isTextEntryTarget`)
- Settings screen lists the same table on pointer devices: `/settings`
- Device check: `src/hooks/use-is-touch-device.ts` (`pointer: coarse`)
- Related: [composer](chat/composer.md), [chat](chat/index.md),
  [session panel](session-panel.md)

</details>
