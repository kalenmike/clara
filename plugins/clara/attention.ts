// Clara — human attention.
//
// The ledger decides that an exception needs a person. Clara presents it in the
// session that already carries the request, using a standard OpenCode form when
// an answer is required and a plain message when it is only information.
//
// This module owns the form shape and the small wait loop. The tool definition
// lives in index.ts; the daemon's delivery loop is added below it.

import { now, type Db, type Row } from './db.ts'

const POLL_MS = 1_000
const WAIT_MS = 24 * 60 * 60 * 1_000
const ALERT_LIMIT = 3

/** A session created only because the request had no usable Clara session. */
export const ATTENTION_SESSION_METADATA = {
  initiatedBy: 'clara',
  ledgerAlert: true,
} as const

/** The daemon handoff is not human input and must not be attributed to them. */
export const ATTENTION_PROMPT_METADATA = {
  source: 'daemon',
  synthetic: true,
} as const

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
      await forms.cancel?.({
        sessionID: input.sessionID,
        formID: input.formID,
        message: 'interrupted',
      })
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
      await forms.cancel?.({
        sessionID: input.sessionID,
        formID: input.formID,
        message: 'timed out',
      })
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

// ---------------------------------------------------------------------------
// delivery
// ---------------------------------------------------------------------------

export type AttentionSessionInfo = {
  id: string
  agent?: string
  parentID?: string
  metadata?: Record<string, unknown>
  time?: { archived?: number | null }
}

export type AttentionSessionApi = {
  get(input: { sessionID: string }): Promise<AttentionSessionInfo>
  prompt(input: {
    sessionID: string
    text: string
    metadata?: Record<string, unknown>
    delivery?: 'steer' | 'queue'
  }): Promise<unknown>
  remove?(input: { sessionID: string }): Promise<void>
}

export type CreateAttentionSession = (input: {
  alert: Row
  request?: Row
  workspacePath: string
  title: string
  metadata: Record<string, unknown>
}) => Promise<{ id: string } | undefined>

export type DeliverAttentionOptions = {
  db: Db
  session: AttentionSessionApi
  createSession: CreateAttentionSession
  fallbackDirectory?: string
  max?: number
  logger?: {
    info(message: string): void
    error(message: string, error?: unknown): void
  }
}

/**
 * Hand every undelivered exception to the Clara session that already carries
 * its request. If that session is gone, archived, or is not a Clara session,
 * create one and write it back to the ledger so the next alert returns there.
 *
 * The alert is marked only after the prompt is accepted. A failed prompt leaves
 * it unmarked so the next tick retries.
 */
export async function deliverAttention(options: DeliverAttentionOptions): Promise<string[]> {
  const { db, session } = options
  const max = Math.max(1, Math.floor(options.max ?? ALERT_LIMIT))
  const cutoff = new Date(Date.now() - 60 * 60 * 1_000).toISOString()
  const rows = db
    .prepare(
      `SELECT a.*,
              f.session_id AS request_session_id,
              f.workspace_id AS request_workspace_id,
              f.slug AS request_slug,
              fw.path AS request_path,
              fw.session_id AS request_workspace_session,
              aw.id AS alert_workspace_id,
              aw.path AS alert_workspace_path,
              aw.session_id AS alert_workspace_session
         FROM alerts a
         LEFT JOIN requests f ON f.id = a.request_id
         LEFT JOIN workspaces fw ON fw.id = f.workspace_id
         LEFT JOIN workspaces aw ON aw.name = a.workspace
        WHERE a.session_id IS NULL
          AND (a.resolved_at IS NULL
               OR (a.key LIKE 'cancelled:%' AND a.created_at >= ?))
        ORDER BY a.id
        LIMIT ?`
    )
    .all(cutoff, max) as Row[]

  const actions: string[] = []

  for (const row of rows) {
    const label = alertLabel(row)
    const request = row.request_id
      ? (db.prepare('SELECT * FROM requests WHERE id = ?').get(row.request_id) as Row | undefined)
      : undefined
    const workspaceID = row.request_workspace_id ?? row.alert_workspace_id
    const workspacePath =
      row.request_path ?? row.alert_workspace_path ?? options.fallbackDirectory ?? undefined
    const target = row.request_session_id ?? row.alert_workspace_session ?? undefined

    let sessionID = await usableSession(session, target)
    let created = false

    if (!sessionID) {
      if (!workspacePath) {
        options.logger?.error(`attention: no workspace path for ${label}`)
        continue
      }

      let newSession: { id: string } | undefined
      try {
        newSession = await options.createSession({
          alert: row,
          request,
          workspacePath,
          title: `Clara · needs you · ${label}`,
          metadata: { ...ATTENTION_SESSION_METADATA },
        })
      } catch (error) {
        options.logger?.error(`attention: could not create a session for ${label}`, error)
        continue
      }

      if (!newSession) {
        options.logger?.error(`attention: no session was created for ${label}`)
        continue
      }

      sessionID = newSession.id
      created = true
    }

    try {
      await session.prompt({
        sessionID,
        text: attentionPrompt(row, label),
        metadata: { ...ATTENTION_PROMPT_METADATA },
        delivery: 'queue',
      })
    } catch (error) {
      options.logger?.error(`attention: could not prompt ${sessionID} for ${label}`, error)
      if (created) {
        await session.remove?.({ sessionID }).catch(() => {})
      }
      continue
    }

    db.prepare('UPDATE alerts SET session_id = ?, notified_at = ? WHERE id = ?').run(
      sessionID,
      now(),
      row.id
    )

    if (row.request_id) {
      db.prepare('UPDATE requests SET session_id = ? WHERE id = ?').run(sessionID, row.request_id)
    }
    if (!row.request_id && workspaceID) {
      db.prepare('UPDATE workspaces SET session_id = ? WHERE id = ?').run(sessionID, workspaceID)
    }

    actions.push(`${label}: alerted ${sessionID}`)
  }

  return actions
}

async function usableSession(
  session: AttentionSessionApi,
  sessionID: string | undefined
): Promise<string | undefined> {
  if (!sessionID) return undefined

  try {
    const info = await session.get({ sessionID })
    if (!info) return undefined
    if (info.time?.archived != null) return undefined
    if (info.parentID) return undefined
    if (info.metadata?.automation === true) return undefined
    if (info.agent !== 'clara') return undefined
    return info.id
  } catch {
    return undefined
  }
}

function alertLabel(row: Row): string {
  if (!row.request_id) return `workspace${row.workspace ? ` ${row.workspace}` : ''}`
  const id = String(Number(row.request_id)).padStart(3, '0')
  return `${id} ${row.request_slug ?? row.slug ?? 'request'}`
}

function attentionPrompt(row: Row, label: string): string {
  const request = row.request_id
    ? `request ${row.request_id} (${label})`
    : `workspace ${row.workspace ?? label}`
  const stateHint =
    row.kind === 'cancelled'
      ? 'This is a cancelled request: use state info; no answer is needed.'
      : row.kind === 'stalled'
        ? 'This request is stalled: use info when there is nothing to decide, otherwise feedback.'
        : row.kind === 'stage_gate'
          ? 'This stage gate needs a human: use confirm for a go/no-go, or feedback for a note.'
          : 'Use the state that fits: feedback for a free-text answer, form for structured answers, confirm for a go/no-go, or info when nothing is needed.'

  return [
    `Clara daemon: ledger alert "${row.key}" for ${request}.`,
    '',
    String(row.title),
    String(row.body),
    '',
    `The human is already in this session. Confirm the item is still open with clara_ask${
      row.request_id ? ` (${row.request_id})` : ''
    }; if it has resolved, say so and stop.`,
    `Otherwise call clara_attention with alert "${row.key}". ${stateHint}`,
    'Write the context yourself in a short message; the form is only the question.',
    'Do not call clara_approve, clara_gate, or clara_resolve until the human answers.',
  ].join('\n')
}
