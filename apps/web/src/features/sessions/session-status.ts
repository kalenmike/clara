import { ATTENTION_LABELS, type AttentionKind } from '@/features/notifications/attention'

/** Every mark a session row or composer tab can show. */
export type SessionStatusKind =
  'snoozed' | 'question' | 'active' | 'error' | 'plan' | 'review' | 'idle'

export const SESSION_STATUS_LABELS: Record<SessionStatusKind, string> = {
  snoozed: 'Snoozed',
  question: ATTENTION_LABELS.question,
  active: 'Running',
  error: ATTENTION_LABELS.error,
  plan: ATTENTION_LABELS.plan,
  review: ATTENTION_LABELS.review,
  idle: 'Idle',
}

/**
 * Pick the single mark a session shows. A snooze hides everything else, a
 * waiting question beats a running turn, a running turn beats every finished
 * state, and an idle session falls back to its review mark or a plain dot.
 */
export function resolveSessionStatus(input: {
  snoozed: boolean
  active: boolean
  attention: AttentionKind | null
}): SessionStatusKind {
  if (input.snoozed) return 'snoozed'
  if (input.attention === 'question') return 'question'
  if (input.active) return 'active'
  if (input.attention) return input.attention
  return 'idle'
}
