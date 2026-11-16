---
title: Settings
description: Appearance, preferences, notifications, sync, shortcuts, and advanced controls.
sidebar_position: 8
---

# Settings

Open **Settings** from the app header. Settings opens full-window, so the
project sidebar is not shown; on phones the header's section links live in the
top-right menu. The page has seven tabs:
Appearance, Preferences, Models, Notifications, Sync, Shortcuts, and Advanced.
On a narrow screen the tabs become a section menu.

## Simplify settings

The filter icon in the header opens **Simplify settings**, which is on by
default. It keeps the common controls and hides the detail rows most people do
not change:

- Notifications shows one Inbox sounds switch instead of four state switches and
  a volume slider.
- Advanced shows only Reconnect, Disconnect, the surface label and app version
  with its build commit, update state, and the cache reset.
- Other tabs keep their main controls.

Simplification is only a view filter. Turning it on or off never clears a
setting.

## Appearance

Choose **Light**, **Dark**, or **System** mode, then pick a palette: Default,
Solarized, Tokyo Night, Gruvbox, Nord, Rose Pine, Catppuccin, or Clara. Every
palette has light and dark variants.

To add your own, choose **Import theme**, then upload a theme file or paste its
JSON. Clara checks the document, shows the problems it finds, and previews the
light and dark result before you add it. Only the known color tokens are
accepted; stylesheets, selectors, remote resources, and unknown tokens are
rejected. A theme may set only a few colors; anything it leaves out follows
Default. Use the bin button on a custom theme to remove it.

```json
{
  "schemaVersion": 1,
  "name": "Mine",
  "light": {
    "background": "#ffffff",
    "foreground": "#111111",
    "primary": "#0055ff",
    "primary-foreground": "#ffffff"
  },
  "dark": {
    "background": "#000000",
    "foreground": "#eeeeee",
    "primary": "#33aaff",
    "primary-foreground": "#000000"
  }
}
```

Theme, mode, and your custom themes are stored on this device. Turn on
**Theme** in **Settings → Sync** to store the list and the selected palette on
your hub for your other paired devices. Remove a theme on one device and it
disappears from the others. Press `ctrl+x` then `t` to toggle light and dark
without changing the palette.

The hub panel opened from Clara at `/hub` uses this theme and mode. The
server-served panel keeps its own Light, Dark, and System switch. Clara Lab at
`/lab` uses the same theme and mode. The standalone lab service has no client to
follow, so it follows your system's light or dark setting.

The panel and lab use the same controls as the main client, so buttons, fields,
cards, and dialogs look and behave the same across surfaces.

## Preferences

- **Session wording** — rename sessions in the interface. The default is
  **Brief**. Presets include Task, Session, Action, Run, Job, and a custom word.
- **Default agent** — per harness, the last agent selected there or a specific
  agent.
- **Auto-hide composer** — keep the composer folded to its title bar. Point at
  the composer to expand it, or use the pin in the bar to keep it open. Saved
  on this device and available with a mouse or trackpad.
- **Cost display** — **Actual** or **Estimated**. Estimates are marked with `~`.

## Models

Choose **All harnesses** or one paired harness, hide providers and models from
the composer, filter by free or paid, and read capabilities, limits, prices, and
variants. Hiding a model on one harness does not hide it on another. See
[Models and usage](models-and-usage.md).

## Notifications

Turn on desktop notifications, Inbox sounds, UI sounds, push notifications, and
test alerts. See [Notifications](notifications.md).

## Sync

When the hub allows it, Sync shows per-category switches for Theme, Preferences,
Models, Notifications, Project, and Inbox monitor. Each device stores its own
choices. Enabling a category can pull the hub's value and fill missing keys from
this device.

A separate **Single setting** section shares **Orchestrator mode** on its own. It
is not part of any category: enabling it shares only the choice to use the
engine surface, never another preference.

The Sync tab is hidden when the hub disables settings sync.

## Shortcuts

The reference card lists the leader key and every shortcut. It is hidden on
touch-first devices. See [Shortcuts](shortcuts.md).

## Advanced

The Advanced tab contains the server connection, the surface label and app
version with its build commit and update state, and recovery actions:

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
