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

/**
 * A Clara daemon worker session. These are normal stage handoffs, not
 * exceptions; when Clara management is on the ledger alert is the actionable
 * notification instead.
 */
export function isClaraWorkerTitle(title: string | undefined): boolean {
  return /^(Spec|Test|Build|Docs|Judge) · \d{3} /.test(title?.trim() ?? '')
}
