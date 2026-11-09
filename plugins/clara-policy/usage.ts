// Model token accounting for the Clara adapter.
//
// OpenCode reports usage per assistant message. A message can be updated many
// times while it streams, so callers keep a high-water mark per message and
// apply only the increase. The total matches OpenCode's own TokenUsage.total:
// input + output + reasoning + cache read + cache write.

export interface ModelTokens {
  input?: number
  output?: number
  reasoning?: number
  cache?: {
    read?: number
    write?: number
  }
  /** Some harnesses report the aggregate total directly. */
  total?: number
}

export interface TokenEvent {
  sessionID: string
  messageID: string
  usage: ModelTokens
  final: boolean
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0
}

export function tokenTotal(usage: ModelTokens | undefined): number {
  if (!usage) return 0
  const parts =
    count(usage.input) +
    count(usage.output) +
    count(usage.reasoning) +
    count(usage.cache?.read) +
    count(usage.cache?.write)
  return Math.max(parts, count(usage.total))
}

// A cached input token is a fraction of the price of a fresh one, and a long
// session re-reads its context every turn. Weight cache traffic down for budget
// enforcement so a step is not cut off by tokens it did not really spend. Step
// rows and cost displays keep the raw count.
const CACHE_READ_WEIGHT = 0.1
const CACHE_WRITE_WEIGHT = 0.1

export function budgetTokenTotal(usage: ModelTokens | undefined): number {
  if (!usage) return 0
  const cached =
    count(usage.cache?.read) * CACHE_READ_WEIGHT + count(usage.cache?.write) * CACHE_WRITE_WEIGHT
  const parts =
    count(usage.input) + count(usage.output) + count(usage.reasoning) + Math.ceil(cached)
  return parts
}

function delta(seen: Map<string, number>, messageID: string, total: number): number {
  if (!messageID) return 0
  const previous = seen.get(messageID) ?? 0
  if (total <= previous) return 0
  seen.set(messageID, total)
  return total - previous
}

export function tokenDelta(
  seen: Map<string, number>,
  messageID: string,
  usage: ModelTokens | undefined
): number {
  return delta(seen, messageID, tokenTotal(usage))
}

export function budgetTokenDelta(
  seen: Map<string, number>,
  messageID: string,
  usage: ModelTokens | undefined
): number {
  return delta(seen, messageID, budgetTokenTotal(usage))
}

type EventLike = {
  type?: unknown
  data?: unknown
  properties?: unknown
}

/**
 * Read model usage from the two OpenCode event shapes the adapter receives.
 * `session.step.*` is the v2 step event; `message.updated` is the assistant
 * message event. Both identify the assistant message, so the high-water mark in
 * `tokenDelta` can deduplicate them.
 */
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
