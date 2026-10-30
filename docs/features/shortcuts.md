# Shortcuts

## Summary

Clara mirrors the OpenCode keyboard model so people can drive sessions without
reaching for the mouse. A leader key covers session, model, agent, and info
actions; direct keys handle interruption and switching.

## User flow

1. Press `ctrl+x` (the leader). Clara waits two seconds for the next key.
2. Press `n` to create a session, `l` for the project session list, or `s` to
   toggle session info.
3. Press `m` for the model picker or `a` for the agent picker.
4. Press `c` to compact the context, `y` to copy the last reply, or `t` to toggle
   the theme.
5. Press Tab or Shift+Tab outside a text field to cycle agents.
6. Press `ctrl+t` to cycle the current model's variants.
7. Press Escape to interrupt a running agent or close an open menu or dialog.

## Core business rules

1. The leader is `ctrl+x` and expires after 2 seconds.
2. Shortcuts do not fire while typing in an input, textarea, or contenteditable
   element, except the leader itself and Escape.
3. Tab only cycles agents when focus is outside a text field, so it still indents
   and moves focus normally inside the composer.
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
- **Menu open in the composer** — Escape closes the menu first.
- **Browser-reserved keys** — the browser may intercept combinations such as
  `ctrl+t` or `ctrl+x` before Clara sees them, depending on platform and focus.
- **Dialog open** — Escape closes the dialog instead of interrupting the run.

## Out of scope

- User-customizable keybindings
- A which-key overlay or shortcut editor
- Vim or Emacs modal editing
- Shortcuts for diff, revert, or worktrees

## Known gaps

- `ctrl+t` is also the browser's "new tab" shortcut and may not reach Clara in
  some browsers.
- Escape can both close a menu and interrupt a run when focus is outside the
  composer; the global handler is intentionally permissive.
- The theme shortcut toggles between light and dark and does not cycle through
  "system".

## Technical appendix

<details>
<summary>Routes, data, and references</summary>

| Keys                | Action               |
| ------------------- | -------------------- |
| `ctrl+x` `n`        | New session          |
| `ctrl+x` `l`        | Project session list |
| `ctrl+x` `m`        | Model picker         |
| `ctrl+x` `a`        | Agent picker         |
| `ctrl+x` `c`        | Compact context      |
| `ctrl+x` `s`        | Toggle session info  |
| `ctrl+x` `t`        | Toggle theme         |
| `ctrl+x` `y`        | Copy last reply      |
| `tab` / `shift+tab` | Cycle agent          |
| `ctrl+t`            | Cycle model variant  |
| `escape`            | Interrupt or close   |
| `shift+enter`       | Newline              |

- Hook: `src/hooks/use-keybinds.ts`
- Settings screen lists the same table: `/settings`
- Related: [composer](composer.md), [chat](chat.md)

</details>
