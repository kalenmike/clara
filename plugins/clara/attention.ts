// Clara — human attention.
//
// The ledger decides that an exception needs a person. Clara presents it in the
// session that already carries the feature, using a standard OpenCode form when
// an answer is required and a plain message when it is only information.
//
// This module owns the form shape and the small wait loop. The tool definition
// lives in index.ts; the daemon's delivery loop is added below it.

const POLL_MS = 1_000
const WAIT_MS = 24 * 60 * 60 * 1_000

export const ATTENTION_STATES = ['feedback', 'form', 'confirm', 'info'] as const

export type AttentionState = (typeof ATTENTION_STATES)[number]

export type AttentionField = {
  key: string
  title?: string
  description?: string
  type: 'string' | 'number' | 'integer' | 'boolean' | 'multiselect'
  required?: boolean
  options?: Array<{ value: string; label: string; description?: string }>
  max_length?: number
  placeholder?: string
}

export type AttentionInput = {
  alert: string
  state: AttentionState
  title?: string
  prompt?: string
  fields?: AttentionField[]
  confirm_label?: string
}

export type AttentionForm = {
  id: string
  state:
    | { status: 'pending' }
    | { status: 'answered'; answer: Record<string, unknown> }
    | { status: 'cancelled'; message?: string }
}

export type AttentionFormApi = {
  create(input: {
    sessionID: string
    title: string
    metadata?: Record<string, unknown>
    fields: unknown[]
  }): Promise<{ id: string }>
  get(input: { sessionID: string; formID: string }): Promise<AttentionForm>
  cancel?(input: { sessionID: string; formID: string; message?: string }): Promise<void>
}

export type AttentionResult =
  | { status: 'answered'; answer: Record<string, unknown> }
  | { status: 'cancelled'; message?: string }

/**
 * The v2 plugin context is a server client. Forms are not listed on the
 * documented session subset, so use `session.form` when present and fall back
 * to the raw client. When neither exists the tool asks in prose instead.
 */
export function attentionFormApi(ctx: any): AttentionFormApi | undefined {
  const api = ctx?.session?.form ?? ctx?.client?.session?.form
  if (!api?.create || !api?.get) return undefined

  return {
    async create(input) {
      return unwrap(await api.create(input))
    },
    async get(input) {
      return unwrap(await api.get(input))
    },
    async cancel(input) {
      if (api.cancel) await api.cancel(input)
    },
  }
}

export function attentionFields(input: AttentionInput): unknown[] {
  if (input.state === 'info') return []

  if (input.state === 'feedback') {
    return [
      {
        key: 'response',
        type: 'string',
        title: input.prompt ?? 'Your answer',
        required: true,
        maxLength: 4_000,
      },
    ]
  }

  if (input.state === 'confirm') {
    return [
      {
        key: 'confirm',
        type: 'boolean',
        title: input.prompt ?? input.confirm_label ?? 'Confirm',
        required: true,
      },
    ]
  }

  const fields = (input.fields ?? []).map(mapField)
  return fields.length
    ? fields
    : [{ key: 'response', type: 'string', title: 'Your answer', required: true }]
}

export async function waitForAttentionForm(
  forms: AttentionFormApi,
  input: { sessionID: string; formID: string; signal?: AbortSignal }
): Promise<AttentionResult> {
  const started = Date.now()

  while (true) {
    if (input.signal?.aborted) {
      await forms.cancel?.({ sessionID: input.sessionID, formID: input.formID, message: 'interrupted' })
      return { status: 'cancelled', message: 'interrupted' }
    }

    const form = await forms.get({ sessionID: input.sessionID, formID: input.formID })
    if (form.state.status === 'answered') {
      return { status: 'answered', answer: form.state.answer ?? {} }
    }
    if (form.state.status === 'cancelled') {
      return { status: 'cancelled', message: form.state.message }
    }

    if (Date.now() - started > WAIT_MS) {
      await forms.cancel?.({ sessionID: input.sessionID, formID: input.formID, message: 'timed out' })
      return { status: 'cancelled', message: 'timed out' }
    }

    await sleep(POLL_MS)
  }
}

export function attentionAnswer(result: AttentionResult): string {
  if (result.status === 'cancelled') {
    return `The human skipped the question${result.message ? ` (${result.message})` : ''}. Do not act on it.`
  }

  const entries = Object.entries(result.answer)
  if (!entries.length) return 'The human answered with no values.'

  const lines = entries.map(([key, value]) => {
    const text = Array.isArray(value) ? value.join(', ') : String(value)
    return `${key}: ${text}`
  })

  const confirmed = result.answer.confirm
  if (typeof confirmed === 'boolean') {
    return confirmed
      ? `The human confirmed.\n${lines.join('\n')}`
      : `The human did not confirm. Do not start.\n${lines.join('\n')}`
  }

  return `The human answered:\n${lines.join('\n')}`
}

function mapField(field: AttentionField): Record<string, unknown> {
  const base = {
    key: field.key,
    title: field.title,
    description: field.description,
    required: field.required ?? false,
  }

  if (field.type === 'boolean' || field.type === 'number' || field.type === 'integer') {
    return { ...base, type: field.type }
  }

  if (field.type === 'multiselect') {
    return { ...base, type: 'multiselect', options: field.options ?? [] }
  }

  if (field.options?.length) {
    return { ...base, type: 'string', options: field.options }
  }

  return {
    ...base,
    type: 'string',
    ...(field.placeholder ? { placeholder: field.placeholder } : {}),
    maxLength: field.max_length ?? 4_000,
  }
}

function unwrap<T>(value: any): T {
  if (value && typeof value === 'object' && 'data' in value) return value.data as T
  return value as T
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
