# Reply composer

## Summary

The reply composer is a Gmail-style window docked to the bottom-right of a chat.
It opens from the **Reply** or **New** button, automatically when a new session
is created or an empty draft with locally saved text is opened, and from Adjust
Plan on the composer's plan-ready card. While it is open or minimized it keeps
the session it was opened for as the person navigates to other sessions; closing
it resets the connection to the current session. It sends prompts that steer the
run by default, can save the first message as a draft without starting a run, can
queue a follow-up behind an active run, and carries commands, mentions,
attachments, model selection, and agent selection. Pending agent questions and a
ready plan travel with it: **Reply** and **New** show a badge for waiting
requests, and the composer stacks those requests above its editor so the person
can answer a form or start work with an optional custom message.

## User flow

1. Click **Reply** in the bottom-right corner of the chat, or **New** on an empty
   draft. The button carries a sky badge with the number of waiting question
   forms and plan-ready handoffs; opening the window shows them as stacked cards
   above the editor. The window opens in the last-used size: expanded
   (maximized) by default, or the smaller docked window if that is how it was
   last restored. While the window is closed, Reply and New always bind it to the
   session currently on screen. Creating a new session opens the window
   automatically at that size and binds it to the new session, and so does
   opening an empty draft that has locally saved text.
2. Type in the large editor. The docked window stays non-modal, so the thread
   remains readable and scrollable behind it.
3. Press Enter to send with steering, or Shift+Enter to add a line. On touch
   devices Enter always adds a line; tap Send to submit.
4. Before the first agent reply, use the send button's chevron menu and choose
   **Save as draft**. Clara sends the prompt with the harness's no-reply mode,
   updates an untitled session to a short title, and leaves the session in
   Drafts. The draft message appears in the thread and a **Start** panel appears
   above it.
5. While the agent is working, use the same chevron menu and choose **Send as
   queued**. The message waits in the session inbox and starts as the next turn
   after the active run settles instead of steering it.
6. Type `/` to open the command palette or `@` to search files, agents, skills,
   and references.
7. Attach files with the paperclip, paste an image, or paste files from the
   clipboard; attachments appear as removable chips.
8. Set the model and variant in the **To** row, and switch the active agent from
   the footer next to Send. Models hidden in **Settings → Models** are absent
   from the picker.
9. When a question form is waiting, select its card above the editor and fill the
   fields. A secondary **Skip** button sits left of Send; use it to discard the
   question without sending. Send is enabled once the form has an answer or the
   editor has a message. With answers and no message, Send answers the form
   alone. With a message and no answers, Send skips the form first and then sends
   the message. With both, Send admits the message and then answers the form. A
   plan-ready card offers a secondary **Start** button: with the editor empty it
   hands off to Build; typing a message disables Start and Send sends the
   message to the Plan agent as an adjustment.
10. Minimize, maximize, or close the window at any time. Switching between the
    expanded panel and the smaller dock is remembered in local storage. The draft
    stays in place until it is sent. While the window is open or minimized,
    opening another session leaves it connected to the original session; the
    title bar shows that session's title and a connection line such as **Draft for
    another brief**. The small return button in the title bar jumps back to the
    connected session without closing the window. Closing the window while
    viewing another session resets it to that session, so the next open shows the
    current session's draft.

## Core business rules

1. Enter and the main Send button steer the session. The chevron menu offers
   **Save as draft** before the first assistant reply, and **Send as queued**
   while a run is active. An idle session that already has a reply has no menu.
2. `/command` input runs a command instead of a prompt. A command runs
   immediately on Send; **Send as queued** keeps it pending until the active run
   settles. **Save as draft** never executes a command: it stores the text
   literally in the draft.
3. The To row owns model and variant; the footer owns the agent. Both reflect the
   session and change it immediately. A hidden or server-disabled model is not
   offered, and its variant menu is hidden.
4. A new message draft picks its agent from the **Default agent** setting: the
   last agent selected anywhere in Clara, or a specific agent. A specific agent
   also replaces the agent of an empty draft the first time that draft is
   opened after the setting changed. Sessions that already have messages keep
   their agent.
5. Unsent composer text is stored per session in local storage. Attachments stay
   with the open window but are not persisted across a reload. An untitled brief
   with no composer text or attachments and no saved draft is discarded when the
   view leaves it, so empty briefs do not accumulate in Drafts.
6. A successful send clears the editor, closes the window, and returns focus to
   Reply when it is visible. Closing resets the connection to the session on
   screen. A failed send keeps the text and attachments on the connected session.
7. The window remembers its size across sessions and reloads. Expanded
   (maximized) is the default; restoring to the smaller dock makes the next
   open — from Reply, New, a new session, a restored local draft, or Steer — use
   the docked size. Minimizing to the title bar is transient and does not
   overwrite the remembered size; restoring returns to the saved size.
8. **Save as draft** is available only before the session has an assistant
   reply. It calls `session.prompt` with `resume: false`, which admits the
   message to the session inbox without starting a run. An untitled session is
   renamed to the first 50 characters of the message plus `…` when truncated.
   The session stays in Drafts because the harness has no projected messages yet.
9. Pending inbox messages are rendered in the thread as draft user messages. A
   **Start** panel above the thread appears when an idle session still has a
   pending user item; it sends a short synthetic approval with steering, which
   delivers the queued draft and starts the run. The handoff renders as a
   system event instead of a user prompt.
10. **Send as queued** calls `session.prompt` or `session.command` with
    `delivery: 'queue'`. The harness keeps the input pending and promotes it as the
    next turn when the session would otherwise become idle, so the active run is
    not redirected. The queued message renders in the thread while it waits.
11. The window is connected to one session at a time. While open or minimized it
    ignores route changes, so prompts, commands, saved drafts, model switches,
    and agent switches all target the connected session. When the window is
    closed, Reply, New, an auto-opened draft, and the model or agent shortcuts
    bind it to the current session. Creating a new session and forwarding a
    message into a new draft explicitly re-target even an open window. A send
    from a session other than the one on screen leaves the view and Monitor
    Inbox position alone; the window still closes and resets to the current
    session.
12. If a send fails because the session's directory was deleted, the window
    reports that the workspace folder is missing and retries automatically after
    moving the session to the project's canonical directory. The retry preserves
    the text, attachments, and delivery; Send, Save as draft, Send as queued, and
    commands all use the same recovery.
13. Waiting requests are part of the composer. Pending question forms and the
    plan-ready handoff render as stacked cards above the editor. The first form
    is selected by default, otherwise the plan-ready card. Selecting a card
    expands it; selecting the selected header again returns to message-only
    mode. The primary Send button keeps its normal label. A secondary button to
    its left is **Skip** for a question and **Start** for a ready plan.
14. A form with a message admits the prompt first with resume disabled, then
    answers the selected form through `session.form.reply`. The form reply
    resumes the blocked run, and the waiting message is promoted at the next step
    boundary, so the message and answer share a turn. An untouched form with a
    message is skipped through `session.form.cancel` first, then the message is
    sent. A touched form with no message answers the form alone. Commands keep
    the form-first order because command execution cannot be cancelled through
    the inbox. The answers are not added to the prompt as files. A failed form
    answer cancels the admitted message so a retry does not duplicate it; a
    failed prompt prevents the form from being answered. **Skip** cancels the
    form without sending, and closing the window leaves the form pending.
15. The plan-ready card switches to the working agent when **Start** is pressed.
    Start sends the synthetic approval and is disabled once the editor has a
    message. Send with a typed message does not switch agents; it sends the
    message to the Plan agent as an ordinary adjustment, and the plan can hand
    off again after the next Plan reply. A failed agent switch or start leaves
    the plan pending.

## Edge cases

- **Empty or whitespace-only prompt** — Send, Save as draft, and Send as queued
  are disabled.
- **Mobile Enter** — touch keyboards have no Shift key, so Enter always inserts
  a new line there, including while the `/` or `@` menu is open; tap a menu item
  to select it and tap Send to submit. Devices with a fine primary pointer keep
  the desktop shortcuts.
- **Mobile focus zoom** — every text input and textarea renders at 16px or more
  on phones (`text-base md:text-sm` or `text-base md:text-xs`). iOS Safari zooms
  the page when a focused field is smaller than 16px, which crops the composer's
  Send button. Keep new mobile inputs at 16px rather than disabling page zoom.
- **Mobile toolbar targets** — below `md` every action button gets a 44px touch
  target: the footer icons, the model and variant pickers, and the buttons in
  permission, form, plan, draft, and git panels. The footer glyphs are 20px.
  Below `sm` the slash, mention, and agent labels collapse to icon-only so the
  row still fits a 320px-wide phone; their accessible names stay in `sr-only`
  text and the agent picker opens with the full list.
- **Mobile screen corners** — below `md` the footer keeps extra bottom padding
  (plus the safe-area inset when the browser reports one) and the floating
  Reply/New cluster sits further from the bottom-right corner. The expanded
  window also insets its bottom edge, so iPhone rounded corners and the home
  indicator do not clip the attach/Send controls.
- **Unknown slash command** — the text is sent as a normal prompt with the chosen
  delivery.
- **Busy session with Send** — the prompt steers the active run instead of
  interrupting it.
- **Busy session with Send as queued** — the prompt waits in the inbox and runs
  as the next turn after the active run settles.
- **Save as draft after a reply** — the chevron offers Send as queued while the
  agent is running and is hidden once the session is idle.
- **Send as queued failure** — the window stays open with the draft and
  attachments intact.
- **Waiting requests** — **Reply** and **New** carry a sky badge with the number
  of pending question forms plus a plan-ready handoff. The cards live above the
  composer editor; nothing opens automatically while the window is closed.
- **Selected request** — the first pending form is selected by default, otherwise
  the plan-ready card. Selecting another form expands it and folds the previous
  one. Selecting the active header returns to message-only mode.
- **Multiple forms** — only the selected form is answered with a message. Other
  forms stay pending and are selected in turn; the secondary Skip button affects
  only the selected form.
- **Form with no message** — an unanswered form leaves Send disabled and Skip
  available. Once a field is touched, Send answers the form alone.
- **Form with an untouched field set and a message** — Send skips the selected
  form first (`session.form.cancel`) and then sends the message.
- **Form sent with a message** — Send admits the message first and then answers
  the selected form, so the form reply resumes the run with the message waiting.
  The answers are not prompt attachments and are sent only through the form
  reply.
- **Form reply fails** — Clara cancels the message it just admitted, keeps the
  composer text, files, and answers so the send can be retried without
  duplication.
- **Form admission fails** — no form is answered; the text, files, and answers
  stay in the window.
- **Cancelling the admitted message fails** — Clara warns that the message may
  already be queued and leaves the text and answers in place.
- **Skip** — the secondary Skip button cancels the selected question without
  sending the editor's message or closing the window.
- **Plan with no message** — the secondary Start button sends the synthetic
  approval, and the handoff renders as a system row.
- **Plan with a message** — Send sends the typed message to the Plan agent as an
  ordinary adjustment; Start is disabled while a message is present.
- **Request while the composer is closed** — the badge counts it, but the
  composer is not forced open.
- **Worker session** — worker sessions have no composer, so their question forms
  stay in the above-thread panel with Submit and Skip controls.
- **Command with Send as queued** — a recognised command is queued and runs as
  the next turn instead of executing immediately.
- **Save as draft failure** — the window stays open with the draft and
  attachments intact.
- **Default agent unavailable** — when the specific agent saved in Settings is
  hidden or removed, new drafts fall back to the last selected agent and the
  Settings card explains why.
- **Specific default on an old empty draft** — the first time an empty draft is
  opened, Clara switches it to the configured agent. A manual switch after that
  is kept until the draft is closed and reopened.
- **Existing conversation** — sessions with any user or assistant message never
  have their agent replaced by the default setting.
- **Hidden current model** — a session stored on a hidden model opens with **No
  model** in the To row. Send, Save as draft, and Send as queued stay disabled
  until a visible model is picked. The session keeps its stored model until then.
- **Draft title failure** — the draft is still saved and a warning reports that
  the title could not be updated.
- **Draft with an existing title** — the title is left unchanged.
- **Command saved as a draft** — the text is stored literally and Start delivers
  it as a user message instead of executing it as a command.
- **Start failure** — the draft stays queued and Start can be retried.
- **Send failure** — the window stays open with the draft and attachments intact.
- **Session directory deleted** — the send reports the missing workspace folder,
  moves the session to the project's canonical directory, and retries the same
  send once. A failed retry leaves the draft and attachments intact.
- **Snoozed session** — sending, queuing, starting the draft, or saving as a draft
  clears the server's snooze marker first, so the session leaves Snoozed.
- **Empty draft** — New replaces Reply and Delete replaces Done. The composer
  opens automatically when locally saved text exists; otherwise New opens it in
  the last-used size (expanded by default).
- **New session** — the window opens in the last-used size and focused, with the
  rest of the start view still visible behind it. If it was already open on
  another session, it re-targets to the new session.
- **Size memory** — the expanded/docked choice survives closing, switching
  sessions, and reloads. An unreadable or missing stored value falls back to
  expanded.
- **Close with a draft** — the Reply or New button shows a draft dot and
  reopening restores the current session's text.
- **Switch sessions with the window open or minimized** — the title bar keeps the
  connected session's title, the connection line says **Draft for another brief**
  (using the configured session noun), and all composer actions keep targeting
  that session.
- **Return control** — the title-bar return button navigates to the connected
  session without closing or resizing the window. It is absent when the connected
  session is already on screen.
- **Close on another session** — the window resets to the session on screen, even
  if the connected session was different. Reopening then shows the current
  session's draft.
- **Send from another session** — the prompt, command, queue, or saved draft goes
  to the connected session. The chat on screen does not scroll or advance Monitor
  Inbox; the window closes and resets to the current session.
- **Create or Forward while detached** — the explicit compose action re-targets
  the window and moves the previous session's text to its local draft.
- **Leave the chat view** — home, projects, and settings unmount the chat-scoped
  composer; returning to a session starts with it closed.
- **Leave an empty brief** — an untitled brief with no messages, no saved draft,
  no waiting request, and no composer text or attachments is deleted after the
  view leaves it. A composer bound to that brief closes and follows the view that
  replaced it; a brief with any of those is kept.
- **Minimized window** — a model or agent shortcut restores the window to its
  saved size before opening its picker, without changing the connected session.
- **Composer title** — the session title is the heading, falling back to **Untitled
  brief** (using the configured noun). The connection line below it always says
  **Draft for this brief** or **Draft for another brief**.
- **File search failure** — the file section is empty; agents, skills, and
  references still appear.
- **Paste with files** — files are attached and the text paste is suppressed.
- **Escape with the palette open** — closes the palette, not the run.
- **Maximized window** — expands to a floating panel with a small margin around
  the viewport until restored or closed.

## Out of scope

- Drag-and-drop attachment zones
- Scheduling a send for a date or time
- Email-style To/Cc/Bcc recipients
- Rich text, signatures, or quoted replies
- Shell mode (`!`), voice input, or prompt history navigation
- Creating or editing command templates in Clara
- Uploading files outside the prompt payload

## Known gaps

- Local composer attachments survive close and minimize on the same session but
  not a rebind to another session or a page reload; only text local drafts are
  persisted. Saved drafts keep their attachments in the session inbox.
- Saved drafts cannot be edited or cancelled from Clara yet; start the draft or
  delete the session.
- Command previews show only the server-provided name and description.
- Mentions insert a path string rather than attaching the referenced file.
- The draft dot does not distinguish text from a draft with only attachments.

## Technical appendix

<details>
<summary>Routes, data, and references</summary>

- Components: `src/components/chat/reply-actions.tsx`,
  `src/components/chat/reply-dock.tsx`, `src/components/chat/composer.tsx`,
  `src/components/chat/composer-request-list.tsx`,
  `src/components/chat/form-fields.tsx`
- Connection state: `src/features/chat/composer-provider.tsx` owns the window
  mode, connected target, handoff text/files, focus requests, draft reports, and
  sent signal for the chat route. `src/features/chat/composer-session.ts` holds
  the open, close, detachment, and return-path rules.
- Target data: `src/features/chat/use-composer-target.ts` reads the connected
  session's info, live snapshot, history, pending inbox drafts, and plan-ready
  state independently of the route.
- Request selection: `src/features/chat/composer-requests.ts` chooses the active
  form or plan card, seeds form answers, and counts requests for the badge.
- Picker components: `model-picker.tsx`, `agent-picker.tsx`
- Model visibility: `src/features/models/visibility.ts`
- Loaded from: `/p/:projectId/s/:sessionId`
- Return path: `/p/<connectedProjectID>/s/<connectedSessionID>`
- Send: `client.session.prompt({ sessionID, text, files, delivery })` with
  `delivery: 'steer'`
- Queue: the same call with `delivery: 'queue'`; commands use
  `client.session.command({ ..., delivery: 'queue' })`
- Default agent: `clara.defaultAgent` (`{ mode: 'last' | 'fixed', agent }`) and
  `clara.lastAgent` in `localStorage`; resolved in
  `src/features/agents/default-agent.ts`
- Save as draft: `client.session.prompt({ sessionID, text, files, resume: false })`
- Form requests: `client.session.form.list({ sessionID })` feeds
  `src/components/chat/composer-request-list.tsx`. A touched form with a message
  admits the prompt with `resume: false` first, then calls
  `client.session.form.reply({ sessionID, formID, answer })` and cancels the
  admitted inbox item if a reply fails. An untouched form with a message calls
  `client.session.form.cancel({ sessionID, formID })` first, then sends the
  prompt. A touched form with no message replies without a prompt. Answers are
  never added to `files`.
- Plan handoff: `src/features/chat/use-start-work.ts` switches the agent to
  `build`; the secondary Start button sends `client.session.synthetic(...)`.
  Send with text leaves the agent alone and sends
  `client.session.prompt(...)` to the Plan agent.
- Draft title: `draftTitleFromText` in `src/features/sessions/draft-title.ts`
  (50 characters plus `…`)
- Pending drafts: `client.session.inbox.list({ sessionID })`
- Start: `client.session.synthetic({ sessionID, text, description, metadata,
delivery: 'steer' })`
- Start panel: `src/components/chat/draft-start-panel.tsx`
- New message view: `src/components/chat/draft-session-view.tsx`
- Commands: `client.command.list()`, `client.session.command({ name, text })`
- File search: `client.file.find({ location, query, type: 'file', limit: 8 })`
- Mentions: `client.agent.list()`, `client.skill.list()`,
  `client.reference.list()`
- Session controls: `client.session.switchAgent`, `client.session.switchModel`
- Draft key: `clara.draft.<sessionID>`
- Size key: `clara.composerSize` (`maximized` or `normal`; default `maximized`)
- Related: [chat](chat.md), [shortcuts](shortcuts.md)

</details>
