export type SessionMailbox = 'inbox' | 'outbox' | 'draft'

export type SessionMailboxSignals = {
  last: 'user' | 'assistant' | 'none'
  awaitingInput: boolean
  /** The newest conversational message is a failed assistant turn. */
  lastError: boolean
  /** The newest conversational message is a finished, error-free Plan reply. */
  planReply: boolean
}

/**
 * Resolve which section a session belongs to.
 *
 * A session needs the person (Inbox) when the agent is waiting on an approval
 * or a question, or when a finished run left the agent's message last. While a
 * run is active the session stays in Outbox even after the agent has written,
 * so a reply landing mid-run never looks like an unanswered message.
 */
export function resolveSessionMailbox(
  signals: SessionMailboxSignals | undefined,
  { running, awaitingInput }: { running: boolean; awaitingInput: boolean }
): SessionMailbox {
  if (signals?.awaitingInput || awaitingInput) return 'inbox'
  if (running) return 'outbox'
  // A failed lookup keeps the historical Inbox fallback.
  const last = signals?.last ?? 'assistant'
  if (last === 'none') return 'draft'
  return last === 'assistant' ? 'inbox' : 'outbox'
}
