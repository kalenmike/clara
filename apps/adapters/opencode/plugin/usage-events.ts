// OpenCode model usage events.
//
// The high-water mark in `tokenDelta` deduplicates the two shapes the adapter
// receives: `session.step.*` is the v2 step event, and `message.updated` is the
// assistant message event.

import type { ModelTokens } from '@clara/binding-core'

export interface TokenEvent {
  sessionID: string
  messageID: string
  usage: ModelTokens
  final: boolean
}

type EventLike = {
  type?: unknown
  data?: unknown
  properties?: unknown
}

export function tokensFromEvent(event: EventLike | undefined): TokenEvent | undefined {
  const type = String(event?.type ?? '')
  if (type === 'session.step.ended' || type === 'session.step.failed') {
    const data = (event?.data ?? event?.properties) as
      { sessionID?: unknown; assistantMessageID?: unknown; tokens?: ModelTokens } | undefined
    const sessionID = String(data?.sessionID ?? '')
    const messageID = String(data?.assistantMessageID ?? '')
    if (!sessionID || !messageID || !data?.tokens) return undefined
    return { sessionID, messageID, usage: data.tokens, final: true }
  }
  if (type !== 'message.updated' && type !== 'message.part.updated') return undefined
  const info = (event?.properties as { info?: unknown } | undefined)?.info as
    | { role?: unknown; id?: unknown; tokens?: ModelTokens; time?: { completed?: unknown } }
    | undefined
  if (info?.role !== 'assistant' || typeof info.id !== 'string' || !info.tokens) return undefined
  const sessionID = String(
    (event?.properties as { sessionID?: unknown } | undefined)?.sessionID ?? ''
  )
  if (!sessionID) return undefined
  return {
    sessionID,
    messageID: info.id,
    usage: info.tokens,
    final: Boolean(info.time?.completed),
  }
}
