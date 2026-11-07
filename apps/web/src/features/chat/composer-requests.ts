import type { FormField, FormInfo } from '@opencode/client'
import type { FormAnswerValue } from '@/features/chat/use-forms'

/**
 * The request the composer's Send button is paired with. `null` means no
 * explicit choice, so the composer selects the first pending form or the
 * plan-ready handoff. `none` is an explicit message-only choice.
 */
export type ComposerRequestSelection =
  { kind: 'form'; formID: string } | { kind: 'plan' } | 'none' | null

export type ComposerRequestAnswers = Record<string, Record<string, FormAnswerValue>>

/** A pending question form and the plan-ready handoff both wait on the person. */
export function composerRequestCount(forms: readonly FormInfo[], planReady: boolean): number {
  return forms.length + (planReady ? 1 : 0)
}

export function defaultComposerSelection(
  forms: readonly FormInfo[],
  planReady: boolean
): ComposerRequestSelection {
  const first = forms[0]
  if (first) return { kind: 'form', formID: first.id }
  if (planReady) return { kind: 'plan' }
  return 'none'
}

/**
 * Keep an explicit choice while it still exists, then fall back to the first
 * pending form or the plan-ready handoff. An explicit message-only choice stays
 * message-only until the person selects a request again.
 */
export function resolveComposerSelection(
  forms: readonly FormInfo[],
  planReady: boolean,
  current: ComposerRequestSelection
): ComposerRequestSelection {
  if (current === 'none') return current
  if (current?.kind === 'form' && forms.some((form) => form.id === current.formID)) return current
  if (current?.kind === 'plan' && planReady) return current
  return defaultComposerSelection(forms, planReady)
}

/** Answers seeded from a form's visible fields and their defaults. */
export function initialFormAnswers(fields: readonly FormField[]): Record<string, FormAnswerValue> {
  const answers: Record<string, FormAnswerValue> = {}
  for (const field of fields) {
    if ('hidden' in field && field.hidden) continue
    if (field.type === 'string' && field.default !== undefined) answers[field.key] = field.default
    if (
      (field.type === 'number' || field.type === 'integer') &&
      typeof field.default === 'number'
    ) {
      answers[field.key] = field.default
    }
    if (field.type === 'boolean') answers[field.key] = field.default ?? false
    if (field.type === 'multiselect' && field.default) answers[field.key] = field.default
  }
  return answers
}
