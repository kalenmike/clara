// Model token accounting for a Clara harness binding.
//
// A harness reports usage per assistant message. A message can be updated many
// times while it streams, so callers keep a high-water mark per message and
// apply only the increase. The total is input + output + reasoning + cache read
// + cache write unless the harness reports its own aggregate.

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
  // Some harnesses only report an aggregate. Use it when the fields are empty.
  return parts > 0 ? parts : count(usage.total)
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
