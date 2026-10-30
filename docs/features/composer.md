# Composer

## Summary

The composer is the prompt box at the bottom of a chat. It sends messages, runs
slash commands, inserts `@` mentions, attaches files, and keeps a per-session
draft so a half-written prompt survives navigation.

## User flow

1. Click the composer and type a prompt.
2. Press Enter to send, or Shift+Enter to add a line.
3. Type `/` to open the command palette; keep typing to filter by name or
   description.
4. Choose a command to insert `/name `, then press Enter to run it with any
   arguments that follow.
5. Type `@` to open the mention palette with files, agents, skills, and
   references; choosing one inserts `@path`.
6. Attach files with the paperclip, drag/paste an image, or paste from the
   clipboard; attachments appear as removable chips.
7. While the agent is running, the send button becomes **Queue**; the message is
   delivered after the current run.
8. Leaving and returning to the session restores the draft.

## Core business rules

1. Enter sends; Shift+Enter inserts a newline. The menu, when open, captures
   Arrow keys, Enter, Tab, and Escape first.
2. Text beginning with `/` and a known command name is sent as a command, not a
   prompt.
3. Mentions are inserted as `@` text references; the file contents are not
   uploaded.
4. Attachments are inlined as data URIs and cleared only after a successful send.
5. Drafts are stored per session and removed when the composer is emptied.

## Edge cases

- **Empty or whitespace-only prompt** — send is disabled.
- **Unknown slash command** — the text is sent as a normal prompt.
- **No commands available** — the palette stays empty; the person can keep
  typing.
- **File search failure** — the file section is empty; agents and skills still
  appear.
- **Very large attachment** — the browser reads it as a data URI; there is no
  explicit size guard.
- **Send failure** — the draft and attachments stay in place.
- **Busy session** — sending queues instead of interrupting.
- **Escape with the palette open** — closes the palette, not the run.
- **Paste with files** — files are attached and the text paste is suppressed.
- **Command has no visible output** — the palette closes and the command runs;
  only the resulting messages confirm it.

## Out of scope

- Drag-and-drop attachment zones
- Shell mode (`!`), voice input, or prompt history navigation
- Editing command templates or creating commands in Clara
- Uploading files to the server outside the prompt payload

## Known gaps

- Command previews show only the server-provided name and description; command
  templates are not exposed by the API.
- Mentions insert a path string rather than attaching the referenced file.
- Message history recall (Up/Down) is not implemented.
- Command execution is fire-and-forget; Clara does not render its own success
  toast.

## Technical appendix

<details>
<summary>Routes, data, and references</summary>

- Component: `src/components/chat/composer.tsx`
- Commands: `client.command.list()`, `client.session.command({ name, text })`
- File search: `client.file.find({ location, query, type: 'file', limit: 8 })`
- Mentions: `client.agent.list()`, `client.skill.list()`,
  `client.reference.list()`
- Draft key: `clara.draft.<sessionID>`
- Related: [chat](chat.md), [shortcuts](shortcuts.md)

</details>
