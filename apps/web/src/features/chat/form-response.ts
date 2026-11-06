import type { FormField, FormInfo } from '@opencode/client'
import type { FormAnswerValue } from '@/features/chat/use-forms'

/** A form answer staged in the composer until the message is sent. */
export type PendingFormResponse = {
  formID: string
  sessionID: string
  title: string
  answers: Record<string, FormAnswerValue>
  entries: Array<{ label: string; value: string }>
}

/**
 * Snapshot the visible answers of a form for display beside the composer. The
 * answer payload itself stays on the response; the entries are only labels.
 */
export function buildFormResponse(
  sessionID: string,
  form: FormInfo,
  answers: Record<string, FormAnswerValue>
): PendingFormResponse {
  const entries: Array<{ label: string; value: string }> = []

  for (const field of form.fields) {
    if ('hidden' in field && field.hidden) continue
    if (field.type === 'external') continue
    if (!Object.prototype.hasOwnProperty.call(answers, field.key)) continue

    entries.push({
      label: field.title ?? field.key,
      value: formatAnswer(field, answers[field.key]),
    })
  }

  return {
    formID: form.id,
    sessionID,
    title: form.title,
    answers,
    entries,
  }
}

export function formResponseSummary(response: PendingFormResponse) {
  const count = response.entries.length
  return count === 1 ? '1 answer' : `${count} answers`
}

function formatAnswer(field: FormField, value: FormAnswerValue | undefined): string {
  if (value === undefined) return '—'

  if (field.type === 'boolean') return value ? 'Yes' : 'No'

  if (field.type === 'multiselect') {
    const selected = Array.isArray(value) ? value : []
    return selected.map((item) => optionLabel(field.options, item)).join(', ') || '—'
  }

  if (field.type === 'string' && field.options) {
    return typeof value === 'string' ? optionLabel(field.options, value) : '—'
  }

  if (Array.isArray(value)) return value.join(', ')
  return String(value)
}

function optionLabel(options: Array<{ value: string; label: string }>, value: string): string {
  return options.find((option) => option.value === value)?.label ?? value
}
