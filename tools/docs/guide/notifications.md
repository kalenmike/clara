---
title: Notifications
description: Inbox alerts, sounds, desktop notifications, and Web Push.
sidebar_position: 9
---

# Notifications

Clara can tell you when a session needs attention, even when the window is in the
background or closed. Alerts are optional and can be tuned per device.

## The four Inbox states

| State                | Meaning                                        |
| -------------------- | ---------------------------------------------- |
| **Needs Input**      | A run is waiting on an approval or a question. |
| **Error**            | The latest reply failed.                       |
| **Ready for Review** | A finished, error-free Plan reply is waiting.  |
| **Brief Complete**   | Any other finished agent reply.                |

A session that is open and focused never alerts. Archived and snoozed sessions,
sessions whose latest message is from you, and interrupted runs do not alert.

## Sounds

Open **Settings → Notifications**.

- **Inbox notification sounds** covers the four states.
- **UI sounds** covers the Done and Build chimes.
- The volume slider applies to both.
- Each state can be muted without silencing the others.

With Simplify settings on, one switch applies to all four states; turning it on
also restores the volume to 70%.

## Desktop notifications

Desktop notifications are offered on devices with a mouse or trackpad. In a
browser, turn the switch on and allow the browser permission. Clara Desktop uses
the operating system's notifications and does not ask. **Send test** confirms
that the operating system actually shows the alert.

Without permission, sounds and the sidebar still work.

## Push notifications

Push notifications work in a browser or installed PWA while Clara is connected
through the hub. They arrive after the last browser window is closed. Clara
Desktop does not include Web Push, because it has no service worker; its native
notifications work while the window is running.

- On iPhone and iPad, add Clara to the Home Screen and open it from that icon
  before turning push on.
- **Send test** proves delivery.
- Tapping a notification focuses Clara and opens the session.

While a desktop Clara window or the Clara Desktop app is visible and recently
used, mobile pushes are held so the desk is alerted once. The idle window is
**Hold phone alerts** in Settings and defaults to five minutes. Hiding or
minimizing the window, locking the screen, or closing the tab releases the phone.

## Alerts from orchestration

When orchestration is reachable, a failed, stalled, or budget-killed run, or a
finished result, is delivered into the Clara session that started it. The
session moves to Needs Input or Ready for Review. A client that uses the
engine surface holds worker-session alerts; other clients receive them
normally.

## In-app toasts

Clara also shows theme-matched toasts with distinct icons for success, warning,
info, and error. Click or tap anywhere on a toast to dismiss it. Swipe away works
too. On phones the toasts appear just below the top bar, so the menu and title
stay reachable.

## If alerts do not arrive

- Check the browser permission for the Clara site, or the operating system's
  notification settings for Clara Desktop.
- On iPhone, confirm Clara was added to the Home Screen and opened from there.
- Send a test notification from Settings.
- If push is on but the phone stays quiet, check whether a desktop Clara window
  is holding mobile pushes.
- Clear cached app data and subscribe again if the push subscription was
  dropped.

See [Troubleshooting](troubleshooting.md).

## Related

- [Settings](settings.md)
- [Understand the screen](concepts.md)
