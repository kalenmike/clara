import type { SessionMessageAssistant } from '@opencode/client'
import { formatCost, formatCount, formatTokens } from '@/lib/format'

/**
 * Usage for one stretch of agent work. Clara hides tool and reasoning steps
 * when internal output is off, so their token and cost totals are rolled into
 * the next visible reply instead of disappearing with their rows.
 */
export type UsageSummary = {
  chars: number
  input: number
  output: number
  cost: number
  /** Whether the cost came from model prices rather than the server. */
  costEstimated: boolean
  tools: number
  turns: number
  hasTokens: boolean
}

export type SummarizeOptions = {
  /** Resolve a step's cost from model prices. Omit to use the reported cost. */
  estimateCost?: (step: SessionMessageAssistant) => number | undefined
}

export function summarizeSteps(
  steps: SessionMessageAssistant[],
  options: SummarizeOptions = {}
): UsageSummary {
  let chars = 0
  let input = 0
  let output = 0
  let cost = 0
  let tools = 0
  let hasTokens = false

  for (const step of steps) {
    for (const part of step.content) {
      if (part.type === 'reasoning') chars += part.text.length
      else if (part.type === 'tool') tools += 1
    }
    if (step.tokens) {
      hasTokens = true
      input += step.tokens.input
      output += step.tokens.output
    }
    const stepCost = options.estimateCost ? (options.estimateCost(step) ?? step.cost) : step.cost
    if (stepCost) cost += stepCost
  }

  return {
    chars,
    input,
    output,
    cost,
    costEstimated: Boolean(options.estimateCost),
    tools,
    turns: steps.length,
    hasTokens,
  }
}

/** Whether a summary has anything beyond an empty placeholder. */
export function hasUsage(summary: UsageSummary): boolean {
  return summary.chars > 0 || summary.tools > 0 || summary.hasTokens || summary.cost > 0
}

/**
 * The muted footer line for a visible reply. It keeps the familiar token and
 * cost order, then adds the hidden-work counts that would otherwise be lost.
 */
export function formatUsageSummary(summary: UsageSummary): string {
  const parts: string[] = []
  if (summary.hasTokens || summary.input > 0 || summary.output > 0) {
    parts.push(`${formatTokens(summary.input)} in · ${formatTokens(summary.output)} out`)
  }
  if (summary.cost > 0) {
    parts.push(formatCost(summary.cost, { estimated: summary.costEstimated }))
  }
  if (summary.chars > 0) parts.push(`${formatCount(summary.chars)} chars`)
  parts.push(`${formatCount(summary.tools)} ${summary.tools === 1 ? 'tool' : 'tools'}`)
  parts.push(`${formatCount(summary.turns)} ${summary.turns === 1 ? 'turn' : 'turns'}`)
  return parts.join(' · ')
}

/**
 * Usage without the reasoning character count, which the thinking row shows
 * beside its label instead of in the footer.
 */
export function formatUsageDetail(summary: UsageSummary): string {
  const parts: string[] = []
  if (summary.hasTokens || summary.input > 0 || summary.output > 0) {
    parts.push(`${formatTokens(summary.input)} in · ${formatTokens(summary.output)} out`)
  }
  if (summary.cost > 0) {
    parts.push(formatCost(summary.cost, { estimated: summary.costEstimated }))
  }
  parts.push(`${formatCount(summary.tools)} ${summary.tools === 1 ? 'tool' : 'tools'}`)
  parts.push(`${formatCount(summary.turns)} ${summary.turns === 1 ? 'turn' : 'turns'}`)
  return parts.join(' · ')
}
