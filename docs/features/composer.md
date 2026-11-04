# Reply composer

## Summary

The reply composer is a Gmail-style window docked to the bottom-right of a chat.
It opens from the **Reply** or **New** button, automatically when a new session
is created or an empty draft with locally saved text is opened, and from Adjust
Plan on the plan-ready card. It sends prompts that steer the run by default, can
save the first message as a draft without starting a run, can queue a follow-up
behind an active run, and carries commands, mentions, attachments, model
selection, and agent selection.

## User flow

1. Click **Reply** in the bottom-right corner of the chat, or **New** on an empty
   draft. The window opens in the last-used size: expanded (maximized) by
   default, or the smaller docked window if that is how it was last restored.
   Creating a new session opens the window automatically at that size, and so
   does opening an empty draft that has locally saved text. The plan-ready
   card's **Adjust Plan** action also opens the window.
2. Type in the large editor. The docked window stays non-modal, so the thread
   remains readable and scrollable behind it.
3. Press Enter to send with steering, or Shift+Enter to add a line.
4. Before the first agent reply, use the send button's chevron menu and choose
   **Save as draft**. Clara sends the prompt with OpenCode's no-reply mode,
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
9. Minimize, maximize, or close the window at any time. Switching between the
   expanded panel and the smaller dock is remembered in local storage. The draft
   stays in place until it is sent.

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
   with the open window but are not persisted across a reload.
6. A successful send clears the editor, closes the window, and returns focus to
   Reply when it is visible. A failed send keeps the text and attachments.
7. The window remembers its size across sessions and reloads. Expanded
   (maximized) is the default; restoring to the smaller dock makes the next
   open — from Reply, New, a new session, a restored local draft, or Steer — use
   the docked size. Minimizing to the title bar is transient and does not
   overwrite the remembered size; restoring returns to the saved size.
8. **Save as draft** is available only before the session has an assistant
   reply. It calls `session.prompt` with `resume: false`, which admits the
   message to the session inbox without starting a run. An untitled session is
   renamed to the first 50 characters of the message plus `…` when truncated.
   The session stays in Drafts because OpenCode has no projected messages yet.
9. Pending inbox messages are rendered in the thread as draft user messages. A
   **Start** panel above the thread appears when an idle session still has a
   pending user item; it sends the prompt `Start` with steering, which delivers
   the queued draft and starts the run.
10. **Send as queued** calls `session.prompt` or `session.command` with
    `delivery: 'queue'`. OpenCode keeps the input pending and promotes it as the
    next turn when the session would otherwise become idle, so the active run is
    not redirected. The queued message renders in the thread while it waits.

## Edge cases

- **Empty or whitespace-only prompt** — Send, Save as draft, and Send as queued
  are disabled.
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
- **Snoozed session** — sending, queuing, starting the draft, or saving as a draft
  clears the server's snooze marker first, so the session leaves Snoozed.
- **Empty draft** — New replaces Reply and Delete replaces Done. The composer
  opens automatically when locally saved text exists; otherwise New opens it in
  the last-used size (expanded by default).
- **New session** — the window opens in the last-used size and focused, with the
  rest of the start view still visible behind it.
- **Size memory** — the expanded/docked choice survives closing, switching
  sessions, and reloads. An unreadable or missing stored value falls back to
  expanded.
- **Close with a draft** — the Reply or New button shows a draft dot and
  reopening restores the text.
- **Switch sessions** — the reply window resets to the new session's draft.
- **Minimized window** — a model or agent shortcut restores the window to its
  saved size before opening its picker.
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

- Local composer attachments survive close and minimize but not a page reload;
  only text local drafts are persisted. Saved drafts keep their attachments in
  the session inbox.
- Saved drafts cannot be edited or cancelled from Clara yet; start the draft or
  delete the session.
- Command previews show only the server-provided name and description.
- Mentions insert a path string rather than attaching the referenced file.
- The draft dot does not distinguish text from a draft with only attachments.

## Technical appendix

<details>
<summary>Routes, data, and references</summary>

- Components: `src/components/chat/reply-dock.tsx`,
  `src/components/chat/composer.tsx`
- Picker components: `model-picker.tsx`, `agent-picker.tsx`
- Model visibility: `src/features/models/visibility.ts`
- Loaded from: `/p/:projectId/s/:sessionId`
- Send: `client.session.prompt({ sessionID, text, files, delivery })` with
  `delivery: 'steer'`
- Queue: the same call with `delivery: 'queue'`; commands use
  `client.session.command({ ..., delivery: 'queue' })`
- Default agent: `clara.defaultAgent` (`{ mode: 'last' | 'fixed', agent }`) and
  `clara.lastAgent` in `localStorage`; resolved in
  `src/features/agents/default-agent.ts`
- Save as draft: `client.session.prompt({ sessionID, text, files, resume: false })`
- Draft title: `draftTitleFromText` in `src/features/sessions/draft-title.ts`
  (50 characters plus `…`)
- Pending drafts: `client.session.inbox.list({ sessionID })`
- Start: `client.session.prompt({ sessionID, text: 'Start', delivery: 'steer' })`
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
