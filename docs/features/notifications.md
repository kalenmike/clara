# Notifications

## Summary

Clara tells the person when a session lands in the Inbox with a system
notification and a distinct sound for each kind of attention. When the Clara
home agent is connected, the same alert can arrive as a Web Push notification
after the last Clara window is closed. Clara management adds a second source:
ledger exceptions such as an open decision, a stalled feature, a missing
approval, or an unverified human gate. The settings card also controls optional
chimes for UI actions such as Done and starting a Build. It is for people who
start an agent run and move on, so they do not have to watch the sidebar.

## User flow

1. The person opens **Settings** on a desktop and turns on **Desktop
   notifications**; the browser asks for permission the first time.
2. Once it is on, a **Send test** button appears so they can confirm a system
   notification actually reaches the operating system.
3. They can keep **Inbox notification sounds** on, adjust the shared volume, and
   mute any of the four states. **UI sounds** controls the Done and Build
   chimes. With Settings simplified, the four state rows and volume slider are
   hidden and the primary switch applies to all of them.
4. They can turn on **Push notifications** on any device when Clara is connected
   through the home agent, then send a test notification to prove delivery.
5. On iPhone and iPad, push requires adding Clara to the Home Screen and opening
   it from that icon before turning push on.
6. A run ends, a question arrives, a plan finishes, or a run fails. Clara plays
   the matching sound and, if the session is not open and focused, shows an
   alert.
7. If Clara is hidden or closed, the home agent sends the push and the person
   taps it. While a desktop client is visible and recently used, mobile pushes
   are held so the desk is alerted once; after the idle window, or when the
   desktop window is hidden, the phone starts receiving alerts again. Clicking
   any notification focuses Clara and opens the session.
8. When Clara management is on and a ledger feature needs a person — a
   decision, stalled work, an approval, a gate, or a budget kill — the home
   agent sends one ledger alert. Tapping it opens **Clara inbox**; the exception
   is not tied to a worker session.
9. When the person marks a session Done or starts work from a ready plan, Clara
   plays the matching UI chime if **UI sounds** is on.
10. The sidebar still shows the same state with its dot, and the person can
    preview every sound before relying on it.

## Core business rules

1. There are four attention states, in precedence order: **Needs Input** (a
   pending approval or form), **Error** (the latest reply failed), **Ready for
   Review** (a finished, error-free Plan reply), and **Brief Complete** (any
   other finished agent reply).
2. Alerts come from the live event stream, never from page load or reconnect.
   Questions and failures use their own events, while review and Plan ready are
   resolved after a short debounce from the latest messages and forms.
   Interruptions only suppress the next evaluation, and the same state is not
   announced twice for a session within five seconds.
3. The home agent runs the same classification while it is running, so push and
   the open sidebar agree on the state.
4. A session that is open and whose tab is visible and focused never alerts.
   Archived and snoozed sessions, sessions whose latest message is from the
   person, and interrupted runs do not alert.
5. Desktop notifications need browser permission. Without it, sounds and the
   sidebar still work; permission is requested only from the Settings switch.
   Once they are on, the row offers **Send test**, which raises a one-off system
   notification and reports a refusal, so the person can check delivery before
   trusting an alert.
6. Push notifications need browser permission and a Clara home agent; they are
   stored on the agent and sent directly with Web Push. A visible Clara window
   handles its own alert, and a hidden or closed Clara leaves delivery to the
   service worker push so the person is not notified twice. Desktop devices
   always receive push; mobile devices are held while a desktop client is
   present at the desk.
7. Settings shows the controls that fit the current device. **Desktop
   notifications** appears only when the primary pointer is fine, such as a
   laptop with a mouse or trackpad. **Push notifications** appears on every
   device. Hiding a row never clears its stored preference.
8. A connected desktop client holds mobile pushes while its window is visible,
   the person has used it (pointer, keyboard, or scroll) within the idle window,
   and **Desktop notifications** is on so the page can raise the alert. The idle
   window is set in Settings (**Hold phone alerts**) and defaults to five
   minutes. Hiding or minimizing the window, locking the screen, closing the
   tab, or passing the idle window releases the phone.
9. Inbox notification sounds and UI sounds are independent. The volume slider
   applies to both, either can be muted without affecting the other, and the
   Done and Build chimes are UI sounds rather than Inbox alerts. Closed-app
   pushes use the operating system's notification sound. When Settings is
   simplified, the primary Inbox switch applies its new value to all four
   states; turning it on also restores the volume to 70%, and turning
   simplification on alone does not change any state.
10. In-app toasts follow the selected color theme. Success, warning, info, and
    error keep distinct icons, wording, and palette-derived accents, so
    importance is readable without relying on color alone. Error carries the
    strongest tint, warning the next, and success and info the lightest.
11. Toasts show no close control. Clicking or tapping anywhere on the toast
    dismisses it, on desktop and touch alike; the surface keeps auto-dismiss
    timing and swipe-away.
12. Optional settings sync shares sound and alert preferences only:
    Inbox sounds, UI sounds, volume, per-state switches, and the desk idle
    window. Browser notification permission, the desktop switch, and this
    device's push subscription stay local. See [sync](sync.md).
13. Ledger alerts are separate from the four session attention states. They
    come from the home agent's read-only view of the ledger outbox, are
    deduplicated by alert key, and map to **Needs Input** or **Error** for sound
    and push. They are off while Clara management is off.
14. While Clara management is on, the Clara worker sessions (`Spec`, `Test`,
    `Build`, `Docs`, `Judge`) do not raise their own session alerts. The ledger
    alert is the actionable notification; the worker completion is noise.

## Edge cases

- **Desktop notifications unavailable** — permission denied or reset, or an
  unsupported or insecure browser, keeps desktop alerts off. Settings explains
  how to unblock the site and refreshes when the window regains focus; sound
  controls remain.
- **Test desktop notification** — **Send test** raises the system alert at once
  when desktop notifications are on. A refusal from the browser or operating
  system shows an error toast and leaves the switch on so the person can fix the
  block and retry. Clicking a test notification focuses Clara without changing
  the current screen.
- **Touch-first device** — Desktop notifications is hidden, while push and the
  sound controls remain. A tablet with a hardware keyboard still uses the touch
  layout.
- **Touchscreen laptop** — a mouse or trackpad keeps a fine primary pointer, so
  Desktop notifications stays visible.
- **Desktop notifications already on** — a touch device that enabled desktop
  alerts before the layout changed still shows the row until it is switched off,
  then hides it on the next visit.
- **Sound settings** — UI sounds off makes Done and Build silent while Inbox
  alerts still play; Inbox sounds off with UI sounds on makes Inbox states
  silent while the UI chimes still play.
- **Simplified settings** — the four Inbox state rows and volume slider are
  hidden while the primary switch remains. A state muted earlier stays muted
  until the primary switch is toggled, which writes the same value to every
  state and resets the volume to 70% when turned on.
- **Autoplay blocked** — the first click or keypress unlocks audio. A sound that
  cannot play is skipped silently.
- **Theme changed while a toast is open** — the open toast recolors immediately
  because the accents are theme tokens.
- **Missing or unknown palette** — the Default status accents apply, so a stale
  stored theme never leaves a toast unstyled.
- **Forced colors** — the operating system palette wins; icons and wording still
  distinguish the notification state.
- **Tab in the background or window unfocused** — the open session may still
  alert, because the person cannot see it.
- **Another session is open** — the alert is delivered for the session that
  needs attention.
- **Clicking a notification** — Clara resolves the project from the session's
  directory. If no project matches, it focuses the window without navigating.
- **Session archived or snoozed between the event and the alert** — the alert is
  dropped.
- **Interrupted run** — the next idle evaluation is suppressed, so cancelling a
  run does not look like a completed reply.
- **Two overlaid events** — a failed run followed by idle is one error alert, not
  an error and a review.
- **Two Clara tabs** — each tab can alert; the service worker skips push while a
  non-connect window is visible, so the visible tab is the one that alerts.
- **Working at the desk** — a visible, recently used desktop client holds mobile
  pushes, so only the desk is alerted. Desktop push still arrives when that
  browser has no visible window.
- **Walking away** — passing the idle window, minimizing or hiding Clara,
  locking the screen, or closing the tab releases mobile pushes. An open but
  focused window without input counts as away after the window elapses.
- **Clara in a background browser tab** — the tab reports itself as not visible,
  so mobile pushes are not held. An installed desktop window stays visible while
  unfocused, so it keeps holding until the idle window passes.
- **Desktop cannot alert** — if desktop notifications are off and the device has
  no push subscription, it never holds the phone.
- **Old push subscription without a device class** — the agent classifies it from
  the stored user agent; the next subscribe records the class explicitly.
- **Relay reconnect** — presence is re-sent on the next heartbeat, and a stale
  presence entry expires after one minute.
- **Push unavailable** — direct HTTP mode, a home agent without push support, a
  denied permission, or an iPhone that has not installed Clara keeps push off.
  Settings explains which condition applies.
- **iPhone or iPad** — Clara must be installed from Safari and opened from the
  Home Screen icon before permission, subscription, or push delivery works.
- **Push subscription expired** — a `404` or `410` from the push service removes
  the stored subscription. A browser that rotates its subscription is
  reconciled the next time Clara opens.
- **Home agent stopped or asleep** — events during the gap are not replayed, so
  a run that finishes while the agent is down does not push later.
- **Clara management off** — no ledger alerts, no Clara inbox, and Clara worker
  sessions keep their ordinary session alerts. The ledger tools are inert.
- **No Clara client connected** — the home agent raises a local OS notification
  for a ledger alert instead of relying on the browser.
- **A ledger alert arrives twice** — the delivery key and cursor suppress the
  duplicate across reconnects and restarts; one-time kills never enter the open
  inbox.
- **Clara worker completes** — with management on, its session alert is
  suppressed and the ledger exception is the only actionable alert.
- **External OpenCode notifier** — the TUI notifier is a separate plugin and
  does not read the Clara management switch. The home agent's local OS
  notification covers the case where no Clara client is connected.
- **Pairing rotated** — `pair --rotate` clears every stored push subscription, so
  a lost device stops receiving notifications.
- **Push notification tapped while Clara is open** — the existing window is
  focused and navigated to the session.
- **Push payload** — it carries the session title and reason, so the lock screen
  can show the same summary as an in-app alert.

## Out of scope

- Push notifications in direct HTTP mode.
- Per-project or per-kind push filters; all four attention states share the push
  switch.
- Syncing browser notification permission, the desktop switch, or a device's
  push subscription through client settings sync.
- Cross-tab de-duplication beyond the visible-window rule.
- A manual "send to phone" override, a per-device push list, or manual device
  roles; holding is automatic and keyed on the desktop idle window.
- Notifications for retries, queued prompt delivery, or background tasks.
- Grouping or a notification history inside Clara. Session snoozing is separate
  and lives in the sidebar; individual notifications cannot be snoozed.
- Per-action UI sound choices; Done is the only UI sound today.
- Message backlog or offline event replay for the push monitor.
- Theming system and push notifications; the operating system draws their chrome.

## Known gaps

- A system notification is only as reliable as the browser's Notification
  permission and the operating system's Do Not Disturb setting.
- Sound output depends on a prior user gesture in the tab.
- Push delivery is best effort. Apple, Google, and Mozilla push services can
  delay or drop a message, and a home agent that is offline cannot send.
- Brave on desktop has no push service of its own. Subscribing fails until the
  person enables **Use Google services for push messaging** at
  `brave://settings/privacy` and relaunches Brave. Settings names that setting
  when registration fails.
- The custom per-kind sounds, sound switches, and volume do not apply once the
  app is closed; that push uses the operating-system sound and settings.
- System and push notifications are drawn by the operating system, so their
  colors and typography cannot follow the selected palette.
- Losing or rotating `vapid.json` invalidates existing push subscriptions until
  each device subscribes again.
- There is no per-device push list or revoke control; `pair --rotate` clears all
  stored subscriptions.

## Technical appendix

<details>
<summary>Events, state, and references</summary>

- Permission prompt: `permission.asked`; form question: `form.created`
- Failure: `session.execution.failed`; interruption:
  `session.execution.interrupted`
- Review/Plan evaluation: `session.execution.succeeded` and `session.idle`,
  debounced 750 ms
- Signals: `client.session.get({ sessionID })`,
  `client.message.list({ sessionID, order: 'desc', limit: 1, type })` for `user`
  and `assistant`, and `client.session.form.list({ sessionID })`
- State precedence: `packages/shared-types/src/session-signals.ts`, shared by
  the web and the home agent
- Event subscription: `EventProvider` exposes `subscribe`; the
  `NotificationProvider` inside the app shell consumes it
- Desktop notification: service-worker `showNotification` when available,
  falling back to the page Notification API; `silent: true`, tag
  `clara:<sessionID>`, icon `/favicon.png`
- Desktop test notification: `showTestDesktopNotification` in
  `src/features/notifications/notifier.ts`, tag `clara:test`; the settings card
  shows **Send test** while desktop notifications are on and toasts the result
- Sounds: Web Audio motifs in `src/features/notifications/sounds.ts`; the Done
  chime is `playDoneSound` and the Build chime is `playBuildSound`
- Toast theme: `--status-success`, `--status-warning`, `--status-info`, and
  `--status-danger` in `src/index.css` and `src/styles/color-themes.css`; the
  Default palette maps danger to `--destructive`, and palettes adjust a token
  where its icon needs more contrast. Accents and tint rules live in
  `src/index.css` and hook onto the `cn-toast` class in
  `src/components/ui/sonner.tsx`
- Settings: `clara.notifications` in `localStorage` (`desktop`, `push`,
  `sounds`, `uiSounds`, `volume`, `soundKinds`, `deskIdleMs`)
- Presence: the relay heartbeat carries a sealed `presence` payload
  (`deviceClass`, `visible`, `idleMs`, `holdPhone`) every 15 s and immediately
  on visibility, focus, and page hide; `Agent.deskHoldActive()` applies a 60 s
  freshness window
- Device class: `navigator.userAgentData.mobile` when available, then the user
  agent (`Android`, `iPhone`, `iPad`, `iPod`, `Mobile`) and touch Macs; sent as
  `push.subscribe.deviceClass` and stored in `subscriptions.json`
- Push routing: `PushService.notify(payload, { skipMobile })` skips every
  subscription whose class is not `desktop`; desktop subscriptions always send
- Hold window: `DESK_IDLE_OPTIONS_MS` in
  `src/features/notifications/settings.ts` (1, 5, 15, or 30 minutes; default 5)
- Device check: `src/hooks/use-is-touch-device.ts` (`pointer: coarse`), used by
  the settings page and notifications card
- Push labels: Error, Needs Input, Ready for Review, Brief Complete
- Push control: sealed `push.subscribe`, `push.unsubscribe`, and `push.test`
  actions; the agent acknowledges with `push.status`
- Push monitor: `apps/server/src/push/` reads `/api/event`, applies the same
  750 ms evaluation delay and 5 s cooldown, then sends through `web-push`
- Ledger alerts: `plugins/clara/alerts.ts` writes the outbox;
  `apps/server/src/ledger/` reads it read-only, keeps its cursor in `clara.db`,
  sends push/local alerts, and broadcasts `ledger.alert`; the web inbox requests
  `ledger.inbox`
- Ledger alert destination: `/clara` in the web client, backed by the
  read-only `alerts` table in `ledger.db`
- Worker filter: `isClaraWorkerTitle` in
  `packages/shared-types/src/session-signals.ts`, shared by the home agent and
  the web notification provider
- Push storage: `${CLARA_CONFIG_DIR:-~/.config/clara}/subscriptions.json` (mode
  `0600`); VAPID keys live in `vapid.json` next to it
- Push service worker: `apps/web/public/push-sw.js`, loaded by the Clara worker
  (`apps/web/src/sw.ts`) with `importScripts`
- Push setup: `CLARA_VAPID_SUBJECT` optionally overrides the default subject;
  `CLARA_VAPID_PUBLIC_KEY` and `CLARA_VAPID_PRIVATE_KEY` override the stored key
  pair
- Related: [sessions](sessions.md), [capabilities](capabilities.md),
  [pairing](pairing.md)

</details>
