import type { SessionMailboxSignals } from '@clara/shared-types'

export type { SessionMailboxSignals }

export type SessionMailbox = 'inbox' | 'outbox' | 'draft'

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
