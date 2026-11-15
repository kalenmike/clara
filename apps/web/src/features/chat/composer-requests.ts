import type { ClaraFormField, ClaraForm } from '@clara/api-contract'
import type { FormAnswerValue } from '@/features/chat/use-forms'

/**
 * The question form the composer's Send button is paired with. `null` means no
 * explicit choice, so the composer selects the first pending form. `none` is an
 * explicit message-only choice.
 */
export type ComposerRequestSelection = { kind: 'form'; formID: string } | 'none' | null

export type ComposerRequestAnswers = Record<string, Record<string, FormAnswerValue>>

/** Send is useful with a message or a touched question form. */
export function composerCanSend(input: {
  text: string
  formTouched: boolean
  hasActiveForm: boolean
}): boolean {
  return input.text.trim().length > 0 || (input.hasActiveForm && input.formTouched)
}

/** Pending question forms and the plan-ready handoff both wait on the person. */
export function composerRequestCount(forms: readonly ClaraForm[], planReady: boolean): number {
  return forms.length + (planReady ? 1 : 0)
}

export function defaultComposerSelection(forms: readonly ClaraForm[]): ComposerRequestSelection {
  const first = forms[0]
  if (first) return { kind: 'form', formID: first.id }
  return 'none'
}

/**
 * Keep an explicit choice while it still exists, then fall back to the first
 * pending form. An explicit message-only choice stays message-only until the
 * person selects a form again.
 */
export function resolveComposerSelection(
  forms: readonly ClaraForm[],
  current: ComposerRequestSelection
): ComposerRequestSelection {
  if (current === 'none') return current
  if (current?.kind === 'form' && forms.some((form) => form.id === current.formID)) return current
  return defaultComposerSelection(forms)
}

/** Answers seeded from a form's visible fields and their defaults. */
export function initialFormAnswers(
  fields: readonly ClaraFormField[]
): Record<string, FormAnswerValue> {
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
