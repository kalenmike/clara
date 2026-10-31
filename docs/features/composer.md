# Reply composer

## Summary

The reply composer is a Gmail-style window docked to the bottom-right of a chat.
It opens from the **Reply** button, automatically when a new session is created,
or from **Start conversation** on an empty session. It sends prompts that steer
the run by default, can save the first message as a draft without starting a
run, and carries commands, mentions, attachments, model selection, and agent
selection.

## User flow

1. Click **Reply** in the bottom-right corner of the chat. The window opens in
   the last-used size: expanded (maximized) by default, or the smaller docked
   window if that is how it was last restored. Creating a new session opens the
   window automatically at that size; on an empty session, click **Start
   conversation** instead. The plan-ready card's **Steer** action also opens the
   window.
2. Type in the large editor. The docked window stays non-modal, so the thread
   remains readable and scrollable behind it.
3. Press Enter to send with steering, or Shift+Enter to add a line.
4. Before the first agent reply, use the send button's chevron menu and choose
   **Save as draft**. Clara sends the prompt with OpenCode's no-reply mode,
   updates an untitled session to a short title, and leaves the session in
   Drafts. The draft message appears in the thread and a **Start** panel appears
   above it.
5. Type `/` to open the command palette or `@` to search files, agents, skills,
   and references.
6. Attach files with the paperclip, paste an image, or paste files from the
   clipboard; attachments appear as removable chips.
7. Set the model and variant in the **To** row, and switch the active agent from
   the footer next to Send.
8. Minimize, maximize, or close the window at any time. Switching between the
   expanded panel and the smaller dock is remembered in local storage. The draft
   stays in place until it is sent.

## Core business rules

1. Enter and the main Send button steer the session. The chevron menu only
   offers **Save as draft**; there is no separate queue action.
2. `/command` input runs a command instead of a prompt. Commands always run
   immediately. **Save as draft** never executes a command: it stores the text
   literally in the draft.
3. The To row owns model and variant; the footer owns the agent. Both reflect the
   session and change it immediately.
4. Unsent composer text is stored per session in local storage. Attachments stay
   with the open window but are not persisted across a reload.
5. A successful send clears the editor, closes the window, and returns focus to
   Reply when it is visible. A failed send keeps the text and attachments.
6. The window remembers its size across sessions and reloads. Expanded
   (maximized) is the default; restoring to the smaller dock makes the next
   open — from Reply, a new session, Start conversation, or Steer — use the
   docked size. Minimizing to the title bar is transient and does not overwrite
   the remembered size; restoring returns to the saved size.
7. **Save as draft** is available only before the session has an assistant
   reply. It calls `session.prompt` with `resume: false`, which admits the
   message to the session inbox without starting a run. An untitled session is
   renamed to the first 50 characters of the message plus `…` when truncated.
   The session stays in Drafts because OpenCode has no projected messages yet.
8. Pending inbox messages are rendered in the thread as draft user messages. A
   **Start** panel above the thread sends the prompt `Start` with steering,
   which delivers the queued draft and starts the run.

## Edge cases

- **Empty or whitespace-only prompt** — Send and Save as draft are disabled.
- **Unknown slash command** — the text is sent as a normal prompt with steering.
- **Busy session with Send** — the prompt steers the active run instead of
  interrupting it.
- **Save as draft after a reply** — the chevron is hidden; the action is only
  available before the first assistant message.
- **Save as draft failure** — the window stays open with the draft and
  attachments intact.
- **Draft title failure** — the draft is still saved and a warning reports that
  the title could not be updated.
- **Draft with an existing title** — the title is left unchanged.
- **Command saved as a draft** — the text is stored literally and Start delivers
  it as a user message instead of executing it as a command.
- **Start failure** — the draft stays queued and Start can be retried.
- **Send failure** — the window stays open with the draft and attachments intact.
- **Empty session** — Start conversation opens the window in the last-used size
  (expanded by default); the floating Reply button stays hidden until the
  session has a message.
- **New session** — the window opens in the last-used size and focused, with the
  rest of the start view still visible behind it.
- **Size memory** — the expanded/docked choice survives closing, switching
  sessions, and reloads. An unreadable or missing stored value falls back to
  expanded.
- **Close with a draft** — the Reply button shows a draft dot and reopening
  restores the text.
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
- Loaded from: `/p/:projectId/s/:sessionId`
- Send: `client.session.prompt({ sessionID, text, files, delivery })` with
  `delivery: 'steer'`
- Save as draft: `client.session.prompt({ sessionID, text, files, resume: false })`
- Draft title: `draftTitleFromText` in `src/features/sessions/draft-title.ts`
  (50 characters plus `…`)
- Pending drafts: `client.session.inbox.list({ sessionID })`
- Start: `client.session.prompt({ sessionID, text: 'Start', delivery: 'steer' })`
- Start panel: `src/components/chat/draft-start-panel.tsx`
- Commands: `client.command.list()`, `client.session.command({ name, text })`
- File search: `client.file.find({ location, query, type: 'file', limit: 8 })`
- Mentions: `client.agent.list()`, `client.skill.list()`,
  `client.reference.list()`
- Session controls: `client.session.switchAgent`, `client.session.switchModel`
- Draft key: `clara.draft.<sessionID>`
- Size key: `clara.composerSize` (`maximized` or `normal`; default `maximized`)
- Related: [chat](chat.md), [shortcuts](shortcuts.md)

</details>
