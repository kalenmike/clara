import type { JsonValue, SessionMessageSynthetic } from '@opencode/client'

/** Synthetic inputs Clara writes for one-click actions. */
export type ClaraEventKind = 'plan-request' | 'plan-update' | 'build-start'

/** Every system event Clara can render in the transcript. */
export type SystemEventKind = ClaraEventKind | 'question-answer' | 'question-dismissed'

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
}

/**
 * Metadata written on Clara's synthetic inputs. The server persists this with
 * the message but never sends it to the model.
 */
export function claraEventMetadata(kind: ClaraEventKind): Record<string, JsonValue> {
  return { clara: { kind } }
}

/** Whether a synthetic message was written by one of Clara's own actions. */
export function isClaraSynthetic(message: SessionMessageSynthetic): boolean {
  return readClaraEvent(message) !== null
}

export function readClaraEvent(message: SessionMessageSynthetic): SystemEvent | null {
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

function isClaraKind(kind: JsonValue | undefined): kind is ClaraEventKind {
  return kind === 'plan-request' || kind === 'plan-update' || kind === 'build-start'
}

export function readRecord(value: JsonValue | undefined): Record<string, JsonValue> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  return value
}
