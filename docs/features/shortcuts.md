# Shortcuts

## Summary

Clara mirrors the OpenCode keyboard model so people can drive sessions without
reaching for the mouse. A leader key covers session, model, agent, and info
actions; direct keys handle interruption and switching.

## User flow

1. Press `ctrl+x` (the leader). Clara waits two seconds for the next key.
2. Press `n` to create a session and open its draft composer in the last-used
   reply size, `l` for the project session list, `s` to toggle the panel on its
   Info tab, `g` to open the Git tab, or `` ` `` to open the pair terminal.
3. Press `m` for the model picker or `a` for the agent picker. Both open the
   reply window first if it is closed.
4. Press `c` to compact the context, `y` to copy the last reply, `h` to fold or
   open every message, or `t` to toggle light and dark mode without changing the
   selected color theme.
5. Press Tab or Shift+Tab in the message box to cycle agents without leaving it,
   or use `ctrl+.` / `ctrl+shift+.` anywhere on the chat page.
6. Press `ctrl+t` to cycle the current model's variants.
7. Press Escape to interrupt a running agent or close an open menu or dialog.

## Core business rules

1. The leader is `ctrl+x` and expires after 2 seconds.
2. Shortcuts do not fire while typing in an input, textarea, or contenteditable
   element, except the leader, agent cycling (`ctrl+.`, Tab), and Escape.
3. Tab cycles agents while the message box has focus and keeps focus there
   instead of indenting. Tab elsewhere is normal focus traversal, and `ctrl+.`
   cycles agents from anywhere on the chat page.
4. Escape is always offered to the active menu first; the global handler only
   interrupts when no menu consumes it.
5. Shortcuts act on the selected session and project; they do nothing when the
   action has no target.

## Edge cases

- **Leader pressed alone** — the sequence expires silently after two seconds.
- **Leader then unknown key** — nothing happens; the leader resets.
- **No project selected** — `n` and `l` are no-ops.
- **No model variants** — `ctrl+t` is a no-op.
- **Running agent** — Escape interrupts; when idle it does nothing.
- **Menu open in the reply window** — Escape closes the menu first, and Tab
  selects the highlighted item instead of cycling agents.
- **Browser-reserved keys** — the browser may intercept combinations such as
  `ctrl+t` or `ctrl+x` before Clara sees them, depending on platform and focus.
- **Dialog open** — Escape closes the dialog instead of interrupting the run.

## Out of scope

- User-customizable keybindings
- A which-key overlay or shortcut editor
- Vim or Emacs modal editing
- Shortcuts for staging, commits, revert, or worktrees

## Known gaps

- `ctrl+t` is also the browser's "new tab" shortcut and may not reach Clara in
  some browsers.
- Escape can both close a menu and interrupt a run when focus is outside the
  reply window; the global handler is intentionally permissive.
- The theme shortcut toggles between light and dark, keeps the selected color
  theme, and does not cycle through "system".
- Tab and Shift+Tab cycle agents inside the message box, so the textarea cannot
  be left with Tab; click elsewhere to move focus.

## Technical appendix

<details>
<summary>Routes, data, and references</summary>

| Keys                      | Action                         |
| ------------------------- | ------------------------------ |
| `ctrl+x` `n`              | New session                    |
| `ctrl+x` `l`              | Project session list           |
| `ctrl+x` `m`              | Model picker                   |
| `ctrl+x` `a`              | Agent picker                   |
| `ctrl+x` `c`              | Compact context                |
| `ctrl+x` `s`              | Toggle panel (Info tab)        |
| `ctrl+x` `g`              | Open panel on Git tab          |
| `ctrl+x` `` ` ``          | Toggle pair terminal           |
| `ctrl+x` `h`              | Collapse messages              |
| `ctrl+x` `t`              | Toggle light/dark mode         |
| `ctrl+x` `y`              | Copy last reply                |
| `tab` / `shift+tab`       | Cycle agent in the message box |
| `ctrl+.` / `ctrl+shift+.` | Cycle agent from anywhere      |
| `ctrl+t`                  | Cycle model variant            |
| `escape`                  | Interrupt or close             |
| `shift+enter`             | Newline                        |

- Hook: `src/hooks/use-keybinds.ts`
- Settings screen lists the same table: `/settings`
- Related: [composer](composer.md), [chat](chat.md), [git](git.md)

</details>
