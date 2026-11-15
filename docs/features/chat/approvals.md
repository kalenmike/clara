# Approvals and questions

## Summary

Some turns cannot finish without the person. A tool may need permission, the
agent may ask a structured question, or a finished plan may be waiting for a
start. Clara surfaces each of these as a request card with its own actions, keeps
the run blocked until it is answered, and records Clara's own actions in the
thread as system rows rather than fake user prompts.

## User flow

1. When a tool needs approval, a permission card appears above the message list
   with **Allow once**, **Always allow**, and **Reject**. The card starts expanded
   and folds to its header with a click while the request stays pending.
2. A collapsed **Agent's thinking** disclosure on the same card expands to the
   reasoning that led to the request. It is available whether or not internal
   output is on.
3. Choose an answer. The tool run continues, or fails according to the harness's
   own behavior after a rejection; the card disappears either way.
4. When the agent asks a question, its form card appears above the composer
   editor. Select the card and fill its fields. The first pending form is
   selected by default.
5. Press **Send**. With answers and no message, Send answers the form alone; with
   a message and no answers, Send skips the form and then sends the message; with
   both, the message is admitted first and the form is answered after it. The
   secondary **Skip** button cancels the selected form without sending.
6. Submitted answers land in the thread as an **Answered N questions** system
   row, derived from the completed question tool, so the summary survives a
   reload.
7. When a Plan run ends with a final reply, the composer tab carries a request
   badge and the send menu offers **Start work**. With an empty editor, Start
   work switches to the working agent and sends a short synthetic handoff; the
   thread shows **User confirmed. Starting work.** With text in the editor, Start
   work sends that text as the first Build prompt instead. Send leaves the agent
   on Plan and delivers the text as an adjustment.
8. On a session with a saved draft, the queued message appears in the thread with
   a Start card above it. **Start** sends a short synthetic approval, delivers
   the draft, and begins the run; the handoff appears as **User confirmed.
   Starting saved draft.**

## Core business rules

1. Permissions block tool execution until the person chooses once, always, or
   reject; the turn waits on that choice. Each prompt starts expanded and can be
   folded to its header while it stays pending, independently of other cards.
   Folded content is clipped and not focusable, and fold state is held in memory
   for the mounted card only.
2. The **Agent's thinking** disclosure uses the request's tool source to show the
   reasoning that came before that tool call in the same assistant step. It falls
   back to the newest assistant step when the source is unavailable, and stays
   hidden when no reasoning was recorded.
3. Only two request kinds sit above the thread: permission approvals and the
   saved-draft Start card. Both are in normal document flow, so the newest
   message starts just below them, and each starts expanded and folds
   independently. Question forms and the plan-ready handoff live in the composer
   so they never push the thread down.
4. A question form is a selectable card in the composer. Send answers the
   selected form alone when it has no message, or admits the message with resume
   disabled and then answers the form, so the answer resumes the blocked run and
   the waiting message is promoted at the next step boundary instead of racing
   it. An untouched form with a message is cancelled first and then the message
   is sent. Answers are never attached as prompt files, so the model receives
   them once. Only the selected form is answered; other pending forms stay in the
   stack.
5. The plan-ready handoff appears only while the session is idle, the session
   agent is Plan, and the newest user or assistant message is a Plan reply that
   finished with `stop` and no error. It is absent on archived sessions and in
   worker mode, and Start work is hidden while a question form is pending. Both
   Start work and Send disable while a request is in flight.
6. The Start card appears only while the session is idle, not archived, and the
   server reports pending user items in the session inbox. Pending inbox messages
   are merged into the thread by message ID, so a draft is visible before it is
   delivered and disappears cleanly once it becomes a real message. Start sends a
   synthetic approval with steering, which gives the agent context without
   repeating the draft or adding a fake prompt.

## Edge cases

- **Permission rejected** — the request disappears and the agent continues or
  fails according to its own behavior.
- **Form with no message** — an untouched form leaves Send disabled and Skip
  available; once a field is touched, Send answers the form alone.
- **Untouched form with a message** — Send cancels the selected form first, then
  sends the message.
- **Prompt admission fails** — no form is answered and the composer keeps its
  text, files, and answers for retry.
- **Form reply fails after admission** — Clara cancels the message it just
  admitted so a retry does not duplicate it; if that cancellation fails, Clara
  warns that the message may already be queued.
- **Multiple forms waiting** — only the selected form is answered by Send or
  cancelled by Skip; the others stay pending until selected in turn.
- **Folded card while an action is pending** — Start, Skip, or a permission
  decision continues in the background; re-expanding shows the current state.
- **Request resolves while folded** — the card disappears when the request is
  completed or withdrawn, and the next request mounts expanded.
- **Session switch** — every request card returns to expanded; fold state is
  never stored across sessions or reloads.
- **Plan reply without `stop`** — a Plan run that ends on a tool call, an error,
  or a non-stop finish does not show the handoff. A failed agent switch leaves
  Start work in place; a failed handoff asks the person to send from the reply
  box and Monitor Inbox does not advance.

## Out of scope

- Editing or deleting an answer after it is submitted
- Permission policies, per-tool allowlists, or remembered approvals beyond the
  harness's own always-allow
- Starting a plan from anywhere other than the composer send menu

## Known gaps

- Form answers support the common field types but not conditional `when` rules.
- Question answers appear as system events; answers to non-question forms such
  as MCP elicitations are not logged in the thread.

## Technical appendix

<details>
<summary>Routes, data, and references</summary>

- Approvals: `client.permission.request.list`, `client.permission.reply`;
  thinking in `src/features/chat/permission-thinking.ts`
- Forms: `client.session.form.list`, `client.session.form.reply`,
  `client.session.form.cancel`; pending forms live in the composer through
  `src/components/chat/composer-request-list.tsx` and `form-fields.tsx`
- Form with message: `session.prompt({ ..., resume: false })` admits the message
  first, then the selected form is answered, and a failed reply cancels the item
  through `session.inbox.cancel`
- Request cards: `src/components/chat/request-card.tsx` renders the header
  toggle, per-card expanded state, and top-anchored reveal shared by the
  draft-start, question, and permission cards; the permission card itself is
  `src/components/chat/permission-panel.tsx`
- Saved draft: `client.session.inbox.list({ sessionID })`,
  `src/components/chat/draft-start-panel.tsx`, and
  `client.session.synthetic({ ..., delivery: 'steer' })`
- Plan handoff: `src/features/chat/plan-ready.ts` detects it;
  `src/features/chat/use-start-work.ts` switches to `build` and sends the
  synthetic approval or the typed first Build prompt
- Q&A rows: `src/features/chat/questions.ts` derives them from the completed
  `question` tool; `src/components/chat/system-event-row.tsx` renders them
- Related: [chat](index.md), [composer](composer.md), [session panel](../session-panel.md)

</details>
