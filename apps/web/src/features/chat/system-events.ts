import type { ClaraJsonValue, ClaraSessionMessageSynthetic } from '@clara/api-contract'

/** Synthetic inputs Clara writes for one-click actions. */
export type ClaraEventKind = 'plan-request' | 'plan-update' | 'build-start' | 'draft-start'

/** Every system event Clara can render in the transcript. */
export type SystemEventKind =
  ClaraEventKind | 'question-answer' | 'question-dismissed' | 'system-reminder'

const SYSTEM_REMINDER_TAG = /<system-reminder>([\s\S]*?)<\/system-reminder>/gi
const SYSTEM_REMINDER_LABEL = 'System Reminder'

export type SystemEvent = {
  id: string
  kind: SystemEventKind
  label: string
  detail?: string
  time: number
}

const CLARA_LABELS: Record<ClaraEventKind, string> = {
  'plan-request': 'Requested a plan',
  'plan-update': 'Requested a plan update',
  'build-start': 'Started work',
  'draft-start': 'Started saved draft',
}

/**
 * Metadata written on Clara's synthetic inputs. The server persists this with
 * the message but never sends it to the model.
 */
export function claraEventMetadata(kind: ClaraEventKind): Record<string, ClaraJsonValue> {
  return { clara: { kind } }
}

/** Whether a synthetic message was written by one of Clara's own actions. */
export function isClaraSynthetic(message: ClaraSessionMessageSynthetic): boolean {
  return readClaraEvent(message) !== null
}

export function readClaraEvent(message: ClaraSessionMessageSynthetic): SystemEvent | null {
  const clara = readRecord(message.metadata?.clara)
  const kind = clara?.kind
  if (!isClaraKind(kind)) return null

  const detail = typeof clara?.detail === 'string' ? clara.detail : undefined
  return {
    id: message.id,
    kind,
    label: message.description?.trim() || CLARA_LABELS[kind],
    detail,
    time: message.time.created,
  }
}

/**
 * OpenCode injects model-facing mode reminders as untagged synthetic messages.
 * They are not part of the conversation, but the reader can still inspect them
 * through a collapsed system row instead of the raw tagged text.
 */
export function readSystemReminder(message: ClaraSessionMessageSynthetic): SystemEvent | null {
  const detail = systemReminderDetail(message.text)
  if (!detail) return null

  return {
    id: message.id,
    kind: 'system-reminder',
    label: SYSTEM_REMINDER_LABEL,
    detail,
    time: message.time.created,
  }
}

export function isSystemReminder(message: ClaraSessionMessageSynthetic): boolean {
  return systemReminderDetail(message.text) !== null
}

function systemReminderDetail(text: string): string | null {
  const parts = [...text.matchAll(SYSTEM_REMINDER_TAG)]
    .map((match) => match[1]?.trim() ?? '')
    .filter((part) => part.length > 0)

  return parts.length > 0 ? parts.join('\n\n') : null
}

function isClaraKind(kind: ClaraJsonValue | undefined): kind is ClaraEventKind {
  return (
    kind === 'plan-request' ||
    kind === 'plan-update' ||
    kind === 'build-start' ||
    kind === 'draft-start'
  )
}

export function readRecord(value: ClaraJsonValue | undefined): Record<string, ClaraJsonValue> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  return value
}
