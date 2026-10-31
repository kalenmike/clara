# Notifications

## Summary

Clara tells the person when a session lands in the Inbox with a system
notification and a distinct sound for each kind of attention. The same settings
card also controls an optional completion chime for UI actions such as Done. It
is for people who start an agent run and move on to another tab, so they do not
have to watch the sidebar.

## User flow

1. The person opens **Settings** and turns on **Desktop notifications**; the
   browser asks for permission the first time.
2. They can keep **Inbox notification sounds** on, adjust the shared sound
   volume, and mute any of the four states. A separate **UI sounds** switch
   controls the completion chime.
3. A run ends, a question arrives, a plan finishes, or a run fails.
4. Clara plays the matching sound. If the session is not open and focused, it
   also shows a system notification.
5. When the person marks a session Done, Clara plays the completion chime if
   **UI sounds** is on.
6. Clicking the notification focuses Clara and opens that session's chat.
7. The sidebar still shows the same state with its dot, whether or not the alert
   was delivered.
8. The person can preview every sound, including the Done chime, before relying
   on it.

## Core business rules

1. There are four attention states, in precedence order: **Question** (a pending
   approval or form), **Run failed** (the latest reply failed), **Plan ready** (a
   finished, error-free Plan reply), and **Needs review** (any other finished
   agent reply).
2. Alerts come from the live event stream, never from page load or reconnect.
   Questions and failures use their own events, while review and Plan ready are
   resolved after a short debounce from the latest messages and forms.
   Interruptions only suppress the next evaluation, and the same state is not
   announced twice for a session within five seconds.
3. A session that is open and whose tab is visible and focused never alerts.
   Archived and snoozed sessions, sessions whose latest message is from the
   person, and interrupted runs do not alert.
4. Desktop notifications need browser permission. Without it, sounds and the
   sidebar still work; permission is requested only from the Settings switch.
5. Inbox notification sounds and UI sounds are independent. The volume slider
   applies to both, either can be muted without affecting the other, and the
   Done chime is a UI sound rather than an Inbox alert.

## Edge cases

- **Desktop notifications unavailable** — permission denied or reset, or an
  unsupported or insecure browser, keeps desktop alerts off. Settings explains
  how to unblock the site and refreshes when the window regains focus; sound
  controls remain.
- **Sound settings** — UI sounds off makes Done silent while Inbox alerts still
  play; Inbox sounds off with UI sounds on makes Inbox states silent while Done
  still chimes.
- **Autoplay blocked** — the first click or keypress unlocks audio. A sound that
  cannot play is skipped silently.
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
- **Two Clara tabs** — each tab can alert; there is no cross-tab lease.

## Out of scope

- Push notifications after the final Clara tab is closed.
- Service workers, installed-PWA notifications, and mobile-specific behavior.
- Cross-tab de-duplication or leader election.
- Per-project notification settings.
- Notifications for retries, queued prompt delivery, or background tasks.
- Grouping or a notification history inside Clara. Session snoozing is separate
  and lives in the sidebar; individual notifications cannot be snoozed.
- Per-action UI sound choices; Done is the only UI sound today.

## Known gaps

- A system notification is only as reliable as the browser's Notification
  permission and the operating system's Do Not Disturb setting.
- Sound output depends on a prior user gesture in the tab.

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
- State precedence: `src/features/notifications/attention.ts`
- Event subscription: `EventProvider` exposes `subscribe`; the
  `NotificationProvider` inside the app shell consumes it
- Desktop notification: browser Notification API, `silent: true`, tag
  `clara:<sessionID>`, icon `/favicon.svg`
- Sounds: Web Audio motifs in `src/features/notifications/sounds.ts`; the Done
  chime is `playDoneSound`
- Settings: `clara.notifications` in `localStorage` (`sounds`, `uiSounds`,
  `volume`, `soundKinds`)
- Related: [sessions](sessions.md), [capabilities](capabilities.md)

</details>
