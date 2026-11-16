# Notifications

## Summary

Clara alerts the person when a session lands in the Inbox with a system
notification and a distinct sound per state. The browser and desktop client use
operating-system alerts, Web Push reaches a phone after the last browser window
closes, and orchestration delivers run results into the origin session.

## User flow

1. Open **Settings → Notifications** on a desktop and turn on **Desktop
   notifications**; a browser asks for permission, while Clara Desktop grants it.
2. Use **Send test** to confirm that a system notification reaches the
   operating system.
3. Keep **Inbox notification sounds** on, set the shared volume, and mute any
   Inbox state. **UI sounds** controls the Done and Build chimes.
4. On a browser or installed PWA connected through the hub, turn on **Push
   notifications** and send a test push. Clara Desktop hides Web Push; pairing,
   the switch, and revocation live in [connection](connection.md) and
   [panel controls](panel/controls.md).
5. On iPhone and iPad, add Clara to the Home Screen and open it from that icon
   before turning push on.
6. A run ends, a question arrives, a plan finishes, or a run fails: Clara plays
   the matching sound and, when no visible window is focused on that session,
   raises an alert.
7. With every browser window hidden or closed, the hub sends the push. Tapping a
   push or a Clara Desktop notification focuses Clara and opens the session.
8. Orchestration delivers alerts and finished results into the origin session,
   and Done or Start work plays its UI chime when **UI sounds** is on.

## Core business rules

1. **Four attention states, live events only.** Needs Input, Error, Ready for
   Review, and Brief Complete, in that precedence, come from the event stream,
   never page load or reconnect. Questions and failures have their own events,
   review and Plan debounce 750 ms, an interruption suppresses the next
   evaluation, and the same state is not announced twice within five seconds.
2. **Open work does not alert.** An open, visible, focused session never alerts,
   nor do archived or snoozed sessions, sessions whose latest message is from the
   person, or interrupted runs. The sidebar dot still shows the state.
3. **Sounds are per state; chimes are separate.** Inbox sounds keep one switch per
   state and share the volume with UI sounds. Done and Build are UI chimes.
   Synced preferences cover sounds, UI sounds, volume, per-state switches, and
   the desk idle window; browser permission, the desktop switch, and this
   device's push stay local. See [sync](sync.md).
4. **Delivery needs permission and, for push, a hub.** Browser alerts need
   permission; Clara Desktop uses native notifications and grants them itself.
   Push stores its subscription on the hub and is unavailable in Clara Desktop.
   A visible window raises its own alert; a hidden or closed one defers to the
   service worker. Desktop devices always receive push; mobile is held while a
   desktop client is at the desk and recently active, then released by hiding,
   minimizing, locking, closing, or passing the idle window.
5. **Orchestration reuses the same states.** The adapter delivers new alerts and
   finished root runs into the origin session as queued synthetic prompts, at
   most one completion prompt per root run. A client in orchestrator mode holds
   alerts for automation sessions while the hub feature is on, because the
   origin conversation is the actionable one; other clients keep worker alerts.
   See [orchestration](orchestration/index.md).

## Edge cases

- **Desktop notifications unavailable** — a denied or reset browser permission,
  an unsupported browser, or an OS block keeps alerts off. Clara Desktop uses
  the notification center; sounds and the sidebar still work.
- **Send test refused** — a refusal from the browser, notification plugin, or OS
  shows an error toast and leaves the switch on. Clicking the test notification
  focuses Clara without changing the screen.
- **Touch-first device** — the desktop row is hidden while push and the sound
  controls remain. Hiding a row never clears its stored preference, so a device
  that enabled desktop alerts earlier keeps the row until it is switched off.
- **iPhone, iPad, or Brave** — iOS needs the Home Screen install before
  permission, subscription, or delivery works; Brave needs **Use Google services
  for push messaging** before it can subscribe.
- **Expired subscription** — a `404` or `410` removes the stored subscription,
  and a browser that rotates its subscription is reconciled the next open.
- **Hub or harness offline** — events during the gap are not replayed, so a run
  that finishes then does not push later; the hub reopens the stream when the
  adapter reconnects.
- **Two windows** — each visible tab can alert, and the service worker skips push
  while a Clara window is visible, so the person is alerted once.
- **Native click limits** — Windows reports a click only while the toast is on
  screen, and macOS may deliver a banner to Notification Center without popping
  it; the session opens whenever the click is reported.
- **Origin session gone** — the alert stays in the inbox and no prompt is queued,
  and a completed run is never delivered twice because the adapter keeps a
  delivery cursor.

## Out of scope

- Per-project or per-kind push filters; all four attention states share one push
  switch and one sound switch each. Browser permission, the desktop switch, and a
  device's push subscription never sync.
- Cross-tab de-duplication beyond the visible-window rule, and a manual
  send-to-phone override.
- Web Push in Clara Desktop, which has no service worker, and native per-state
  notification sounds; Clara keeps its Web Audio motifs in the running window.
- Notification grouping, history, per-notification snoozing, per-action UI sound
  choices, message backlog for the push monitor, and theming system or push
  notifications, which the operating system draws.

## Known gaps

- A system notification is only as reliable as the permission and the operating
  system's Do Not Disturb setting, and sound output depends on a prior user
  gesture in the tab; a sound that cannot play is skipped silently.
- Push delivery is best effort. Push services can delay or drop a message, and a
  hub that is offline cannot send.
- Rotating `vapid.json` invalidates existing subscriptions until each device
  subscribes again, and an unreadable `subscriptions.json` stops new
  subscriptions until it is fixed or reset.
- The per-state sounds and volume do not apply once the app is closed; that push
  uses the operating system's sound and settings.
- Clara Desktop uses the platform notification service: Windows reports a click
  only while the toast is on screen, and macOS may use the deprecated path.

## Technical appendix

<details>
<summary>Events, storage, and references</summary>

- Events: `permission.asked`, `form.created`, `session.execution.failed`,
  `.interrupted`, `.succeeded`, and `session.idle`, debounced 750 ms
- State precedence: `packages/contracts/shared-types/src/session-signals.ts`,
  shared by the web and the hub
- Desktop notification: the web uses service-worker `showNotification` with
  `silent: true`; Clara Desktop uses `tauri-plugin-notification`, carries
  `{ url, sessionID, kind }` in `extra`, and focuses the window from `onAction`
- Sounds: Web Audio motifs in `src/features/notifications/sounds.ts`; settings in
  `clara.notifications` (`desktop`, `push`, `sounds`, `uiSounds`, `volume`,
  `soundKinds`, `deskIdleMs`)
- Presence: the relay heartbeat carries a sealed `presence` payload
  (`deviceClass`, `visible`, `idleMs`, `holdPhone`) every 15 s;
  `Agent.deskHoldActive()` applies a 60 s freshness window
- Device class: `navigator.userAgentData.mobile`, then the user agent and touch
  Macs; sent as `push.subscribe.deviceClass` and stored with the subscription
- Routing: `PushService.notify(payload, { skipMobile })`; desktop always sends.
  The hold window is `DESK_IDLE_OPTIONS_MS` (1, 5, 15, or 30 minutes; default 5)
- Push monitor: `apps/hub/server/src/push/` keeps one `/events` stream per online
  harness and reuses the debounce, cooldown, and device-keyed routing
- Storage: `${CLARA_CONFIG_DIR:-~/.config/clara}/subscriptions.json` (mode
  `0600`) beside `vapid.json`; `POST /panel/api/v1/push` runs `retry` or `reset`
- VAPID: the panel contact or `CLARA_VAPID_SUBJECT` over `https://clara.local`;
  `CLARA_VAPID_PUBLIC_KEY` and `CLARA_VAPID_PRIVATE_KEY` override the stored pair
- Orchestration: `packages/adapters/binding/src/delivery.ts` and
  `delivery-cycle.ts`; workers are filtered by `isClaraWorkerTitle`
- Related: [settings](settings.md), [sync](sync.md), [connection](connection.md),
  [panel controls](panel/controls.md), [orchestration](orchestration/index.md)

</details>
