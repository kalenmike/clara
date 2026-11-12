---
title: Settings
description: Appearance, preferences, notifications, sync, shortcuts, and advanced controls.
sidebar_position: 8
---

# Settings

Open **Settings** from the sidebar or the start view. The page has seven tabs:
Appearance, Preferences, Models, Notifications, Sync, Shortcuts, and Advanced.
On a narrow screen the tabs become a section menu.

## Simplify settings

The filter icon in the header opens **Simplify settings**, which is on by
default. It keeps the common controls and hides the detail rows most people do
not change:

- Notifications shows one Inbox sounds switch instead of four state switches and
  a volume slider.
- Advanced shows only Reconnect, Disconnect, the app version, update state, and
  the cache reset.
- Other tabs keep their main controls.

Simplification is only a view filter. Turning it on or off never clears a
setting.

## Appearance

Choose **Light**, **Dark**, or **System** mode, then pick a palette: Default,
Solarized, Tokyo Night, Gruvbox, Nord, Rose Pine, Catppuccin, or Clara. Every
palette has light and dark variants.

Theme and mode are stored on this device. Press `ctrl+x` then `t` to toggle light
and dark without changing the palette.

## Preferences

- **Session wording** — rename sessions in the interface. The default is
  **Brief**. Presets include Task, Session, Action, Run, Job, and a custom word.
- **Default agent** — the last agent selected anywhere in Clara, or a specific
  agent.
- **Cost display** — **Actual** or **Estimated**. Estimates are marked with `~`.

## Models

Hide providers and models from the composer, filter by free or paid, and read
capabilities, limits, prices, and variants. See [Models and usage](models-and-usage.md).

## Notifications

Turn on desktop notifications, Inbox sounds, UI sounds, push notifications, and
test alerts. See [Notifications](notifications.md).

## Sync

When the hub allows it, Sync shows per-category switches for Theme, Preferences,
Models, Notifications, Project, and Inbox monitor. Each device stores its own
choices. Enabling a category can pull the hub's value and fill missing keys from
this device.

The Sync tab is hidden when the hub disables settings sync.

## Shortcuts

The reference card lists the leader key and every shortcut. It is hidden on
touch-first devices. See [Shortcuts](shortcuts.md).

## Advanced

The Advanced tab contains the server connection, the app version and update
state, and recovery actions:

- **Reconnect** proves the transport again without forgetting the device.
- **Disconnect** forgets the device in this browser.
- **Update and reload** installs a ready app update.
- **Clear cached app data** resets the service worker and caches. Pairing,
  settings, and drafts are untouched.

If the hub is unreachable, the error stays visible even in simplified mode.

## Related

- [Connect a device](connect.md)
- [Notifications](notifications.md)
- [Troubleshooting](troubleshooting.md)
