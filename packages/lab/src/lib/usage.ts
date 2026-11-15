import type { StepSummary } from '../types'

export interface StepTotals {
  tokens: number
  calls: number
}

type UsageStep = Pick<StepSummary, 'tokens' | 'tool_calls'>

export function totalUsage(steps: UsageStep[]): StepTotals {
  return steps.reduce(
    (totals, step) => ({
      tokens: totals.tokens + step.tokens,
      calls: totals.calls + step.tool_calls,
    }),
    { tokens: 0, calls: 0 }
  )
}
