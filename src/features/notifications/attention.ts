import type { SessionMailboxSignals } from '@/features/sessions/session-mailbox'

export const ATTENTION_KINDS = ['review', 'question', 'plan', 'error'] as const

/** The four reasons an idle session needs the person. */
export type AttentionKind = (typeof ATTENTION_KINDS)[number]

export const ATTENTION_LABELS: Record<AttentionKind, string> = {
  review: 'Needs review',
  question: 'Question',
  plan: 'Plan ready',
  error: 'Run failed',
}

export const ATTENTION_DESCRIPTIONS: Record<AttentionKind, string> = {
  review: 'The agent finished a reply and is waiting for you.',
  question: 'The agent needs an answer or an approval.',
  plan: 'The plan is ready to build or steer.',
  error: 'The last run failed before it finished.',
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
