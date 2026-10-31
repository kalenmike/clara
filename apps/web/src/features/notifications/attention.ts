import {
  ATTENTION_KINDS,
  ATTENTION_LABELS,
  resolveAttentionKind,
  type AttentionKind,
} from '@clara/shared-types'

export { ATTENTION_KINDS, ATTENTION_LABELS, resolveAttentionKind, type AttentionKind }

export const ATTENTION_DESCRIPTIONS: Record<AttentionKind, string> = {
  error: 'The last run failed before it finished.',
  question: 'The agent needs an answer or an approval.',
  plan: 'The plan is ready to review, build, or steer.',
  review: 'The agent finished a reply and is waiting for you.',
}
