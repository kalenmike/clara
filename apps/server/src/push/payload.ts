import { ATTENTION_LABELS, type AttentionKind } from '@clara/shared-types'

const DETAIL_MAX = 180

export type PushNotificationPayload = {
  v: 1
  kind: AttentionKind
  sessionID: string
  title: string
  body: string
  url: string
  tag: string
}

export function buildPushPayload(input: {
  kind: AttentionKind
  sessionID: string
  sessionTitle?: string
  detail?: string
  url: string
}): PushNotificationPayload {
  const name = input.sessionTitle?.trim() || 'Untitled session'
  const suffix = input.detail?.trim() ? `: ${clip(input.detail)}` : '.'

  return {
    v: 1,
    kind: input.kind,
    sessionID: input.sessionID,
    title: ATTENTION_LABELS[input.kind],
    body: attentionBody(input.kind, name, suffix),
    url: input.url,
    tag: `clara:${input.sessionID}`,
  }
}

function attentionBody(kind: AttentionKind, name: string, suffix: string): string {
  switch (kind) {
    case 'review':
      return `Agent finished “${name}” — ready for review.`
    case 'question':
      return `Agent is waiting on you in “${name}”${suffix}`
    case 'plan':
      return `Plan is ready in “${name}” — start work or adjust it.`
    case 'error':
      return `Run failed in “${name}”${suffix}`
  }
}

function clip(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length > DETAIL_MAX ? `${clean.slice(0, DETAIL_MAX - 1)}…` : clean
}
