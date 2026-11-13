export const ATTENTION_KINDS = ['error', 'question', 'plan', 'review'] as const

/** The four reasons an idle session needs the person. */
export type AttentionKind = (typeof ATTENTION_KINDS)[number]

export const ATTENTION_LABELS: Record<AttentionKind, string> = {
  error: 'Error',
  question: 'Needs Input',
  plan: 'Ready for Review',
  review: 'Brief Complete',
}

export type SessionMailboxSignals = {
  last: 'user' | 'assistant' | 'none'
  awaitingInput: boolean
  /** The newest conversational message is a failed assistant turn. */
  lastError: boolean
  /** The newest conversational message is a finished, error-free Plan reply. */
  planReply: boolean
}

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

/**
 * Resolve why a session is in the Inbox. A pending approval or question wins,
 * then a failed reply, then a finished Plan reply, then any other reply that is
 * waiting for the person.
 */
export function resolveAttentionKind(
  signals: SessionMailboxSignals | undefined,
  sessionAgent: string | undefined,
  awaitingInput: boolean
): AttentionKind | null {
  if (awaitingInput || signals?.awaitingInput) return 'question'
  if (!signals || signals.last !== 'assistant') return null
  if (signals.lastError) return 'error'
  if (signals.planReply && sessionAgent === 'plan') return 'plan'
  return 'review'
}

/** A failed turn has no content parts, so it must stay visible even when hidden. */
export function assistantHasFailed(message: { error?: unknown; finish?: string }): boolean {
  return Boolean(message.error) || message.finish === 'error'
}

/** A finished Plan reply that carries no error and stopped on its own terms. */
export function isFinishedPlanReply(message: {
  agent?: string
  finish?: string
  error?: unknown
}): boolean {
  return message.agent === 'plan' && message.finish === 'stop' && !message.error
}
