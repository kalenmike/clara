// Tool-result capping for managed Clara workers.
//
// Budgets are checked between tool calls, so one repo-wide grep or a large
// file read can add far more context than the step has budget for. A harness
// binding can trim the completed tool result before it is stored in the
// conversation and re-sent on every later turn.

export const TOOL_OUTPUT_LIMIT = 48_000
const TAIL_LIMIT = 4_000

function marker(omitted: number): string {
  return `\n\n… [${omitted} characters truncated by Clara: narrow the query, exclude build output, or re-read with offset/limit]\n\n`
}

export function truncateToolOutput(text: string, limit = TOOL_OUTPUT_LIMIT): string {
  if (text.length <= limit) return text
  const kept = Math.max(0, limit - TAIL_LIMIT)
  const tail = Math.min(TAIL_LIMIT, text.length - kept)
  const omitted = text.length - kept - tail
  return `${text.slice(0, kept)}${marker(omitted)}${text.slice(text.length - tail)}`
}

type TextPart = { type?: unknown; text?: unknown }

function capText(value: unknown, limit: number): string | undefined {
  if (typeof value !== 'string') return undefined
  return truncateToolOutput(value, limit)
}

/**
 * Trim the text in a completed `execute.after` event in place. Structured
 * output and non-text parts are preserved; only oversized strings are cut.
 * Returns whether anything changed.
 */
export function capToolResult(event: unknown, limit = TOOL_OUTPUT_LIMIT): boolean {
  if (!event || typeof event !== 'object') return false
  const result = (event as { result?: { output?: unknown; content?: unknown } }).result
  if (!result || typeof result !== 'object') return false
  let changed = false

  const output = capText(result.output, limit)
  if (output !== undefined && output !== result.output) {
    result.output = output
    changed = true
  }

  if (Array.isArray(result.content)) {
    let budget = limit
    for (const part of result.content as TextPart[]) {
      if (!part || part.type !== 'text' || typeof part.text !== 'string') continue
      const text = part.text
      if (budget <= 0) {
        part.text = ''
        changed = true
        continue
      }
      const next = text.length > budget ? truncateToolOutput(text, budget) : text
      if (next !== text) {
        part.text = next
        changed = true
      }
      budget = Math.max(0, budget - next.length)
    }
  }

  return changed
}
