---
title: Shortcuts
description: The leader key, direct keys, and sidebar selection.
sidebar_position: 10
---

# Shortcuts

Clara follows the OpenCode keyboard model. Shortcuts do not fire while you are
typing in a text field, except where noted.

## The leader key

Press `ctrl+x` with focus outside a text field. Clara waits two seconds for the
next key.

| Key     | Action                                 |
| ------- | -------------------------------------- |
| `n`     | New session and focus its composer tab |
| `l`     | Project session list                   |
| `s`     | Toggle the right panel on its Info tab |
| `g`     | Open the Git tab                       |
| `` ` `` | Open the pair terminal                 |
| `m`     | Model picker (restores the composer)   |
| `a`     | Agent picker (restores the composer)   |
| `c`     | Compact the context                    |
| `y`     | Copy the last reply                    |
| `h`     | Fold or open every message             |
| `t`     | Toggle light and dark mode             |

The leader expires silently after two seconds. An unknown key resets it.

## Direct keys

| Key                            | Action                                           |
| ------------------------------ | ------------------------------------------------ |
| `Tab` / `Shift+Tab`            | Cycle agents while the message box has focus     |
| `ctrl+.` / `ctrl+shift+.`      | Cycle agents from anywhere on the chat page      |
| `ctrl+t`                       | Cycle the current model's variants               |
| `Escape`                       | Interrupt a run, or close an open menu or dialog |
| `Shift+Enter`                  | New line in the composer                         |
| `Shift+Enter` on a session row | Extend a selection from the anchor               |
| `Delete` / `Backspace`         | Delete selected sessions after confirmation      |

Escape has an order: it closes an open menu or dialog first, then cancels a part
selection, and only then interrupts the run.

`ctrl+x` keeps its native cut behavior while a text field has focus. The browser
may intercept combinations such as `ctrl+t` depending on platform and focus.

## Sidebar selection

A normal click opens a session and sets the selection anchor. Shift-click another
row selects the range between them. Shift+Enter extends the selection from a
focused row. With a selection, Delete or Backspace opens the confirmation dialog.
The shortcut is ignored while typing or while another dialog is open.

## Related

- [Chat and approvals](chat.md)
- [The reply composer](composer.md)
- [Settings](settings.md)
