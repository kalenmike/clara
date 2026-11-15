# Notifications

## Summary

Clara tells the person when a session lands in the Inbox with a system
notification and a distinct sound per attention state. While the hub is
connected, the same alert can arrive as a Web Push after the last Clara window
closes, and orchestration delivers run alerts and finished results into the
session that started them. It is for people who start a run and move on.

## User flow

1. Open **Settings → Notifications** on a desktop and turn on **Desktop
   notifications**; the browser asks for permission the first time.
2. Use **Send test** to confirm that a system notification reaches the
   operating system.
3. Keep **Inbox notification sounds** on, set the shared volume, and mute any
   Inbox state. **UI sounds** controls the Done and Build chimes.
4. On a device connected through the hub, turn on **Push notifications** and send
   a test push. Pairing, the push switch, and revocation live in
   [connection](connection.md) and [panel controls](panel/controls.md).
5. On iPhone and iPad, add Clara to the Home Screen and open it from that icon
   before turning push on.
6. A run ends, a question arrives, a plan finishes, or a run fails: Clara plays
   the matching sound and, when no visible window is focused on that session,
   raises an alert.
7. With every Clara window hidden or closed, the hub sends the push. Tapping it
   focuses Clara and opens the session.
8. When orchestration is reachable and a run needs a person, the adapter queues
   the alert or the finished result into the origin session, which moves to
   Needs Input for an alert or Ready for Review for a completed result.
9. Marking a session Done or starting from a ready plan plays the matching UI
   chime when **UI sounds** is on.

## Core business rules

1. **Four attention states, live events only.** Needs Input (pending approval or
   form), Error (latest reply failed), Ready for Review (finished, error-free Plan
   reply), and Brief Complete (any other finished reply), in that precedence.
   Alerts come from the event stream, never page load or reconnect; questions and
   failures have their own events, review and Plan resolve after a 750 ms
   debounce, an interruption suppresses the next evaluation, and the same state is
   not announced twice within five seconds.
2. **Open work does not alert.** An open, visible, focused session never alerts,
   nor do archived or snoozed sessions, sessions whose latest message is from the
   person, or interrupted runs. The sidebar dot still shows the state.
3. **Sounds are per state; chimes are separate.** Inbox sounds keep one switch per
   attention state and share the volume with UI sounds, and either can be muted
   alone. Done and Build are UI chimes, and a closed app uses the operating
   system's sound. Synced preferences cover sounds, UI sounds, volume, per-state
   switches, and the desk idle window; browser permission, the desktop switch,
   and this device's push subscription stay local. See [sync](sync.md).
4. **Delivery needs permission and, for push, a hub.** Desktop alerts need
   browser permission and a fine primary pointer; push needs permission too and
   stores its subscription on the hub. A visible window raises its own alert,
   while a hidden or closed one defers to the service worker. Desktop devices
   always receive push; mobile is held while a desktop client is at the desk and
   was used within the idle window, then released by hiding, minimizing, locking,
   closing, or passing that window.
5. **Orchestration reuses the same states.** The adapter delivers new alerts and
   finished root runs into the origin session as queued synthetic prompts, at most
   one completion prompt per root run. A client in orchestrator mode holds alerts
   for automation sessions while the hub feature is on, because the origin
   conversation is the actionable one; other clients keep worker alerts. See
   [orchestration](orchestration/index.md).

## Edge cases

- **Desktop notifications unavailable** — a denied or reset permission, or an
  unsupported or insecure browser, keeps desktop alerts off. Sounds and the
  sidebar still work, and Settings explains how to unblock the site and refreshes
  when the window regains focus.
- **Send test refused** — a refusal from the browser or operating system shows an
  error toast and leaves the switch on so the person can retry. Clicking the test
  notification focuses Clara without changing the current screen.
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
- **Origin session gone** — the alert stays in the inbox and no prompt is queued,
  and a completed run is never delivered twice because the adapter keeps a
  delivery cursor.

## Out of scope

- Per-project or per-kind push filters; all four attention states share one push
  switch and one sound switch each. Browser permission, the desktop switch, and a
  device's push subscription never sync.
- Cross-tab de-duplication beyond the visible-window rule, and a manual
  send-to-phone override.
- Notification grouping, history, per-notification snoozing, per-action UI sound
  choices, message backlog for the push monitor, and theming system or push
  notifications, which the operating system draws.

## Known gaps

- A system notification is only as reliable as the browser's permission and the
  operating system's Do Not Disturb setting, and sound output depends on a prior
  user gesture in the tab; a sound that cannot play is skipped silently.
- Push delivery is best effort. Push services can delay or drop a message, and a
  hub that is offline cannot send.
- Rotating `vapid.json` invalidates existing subscriptions until each device
  subscribes again, and an unreadable `subscriptions.json` stops new
  subscriptions until it is fixed or reset.
- The per-state sounds and volume do not apply once the app is closed; that push
  uses the operating system's sound and settings.

## Technical appendix

<details>
<summary>Events, storage, and references</summary>

- Events: `permission.asked`, `form.created`, `session.execution.failed`,
  `.interrupted`, `.succeeded`, and `session.idle`, debounced 750 ms
- State precedence: `packages/contracts/shared-types/src/session-signals.ts`,
  shared by the web and the hub
- Desktop notification: service-worker `showNotification` with `silent: true`,
  tag `clara:<sessionID>`, icon `/favicon.png`; the test uses `clara:test`
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
