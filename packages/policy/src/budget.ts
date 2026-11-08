import type { EffectiveBudget, Limits, Usage } from './types.ts'

const finite = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback

const positive = (value: number): number => Math.max(0, Math.floor(value))

export function computeBudget(limits: Limits | undefined, attempt = 1): EffectiveBudget {
  const safeAttempt = Math.max(1, Math.floor(attempt))
  const turns = limits?.turns
  const tokens = limits?.tokens

  const turnInitial = positive(finite(turns?.initial, 10))
  const turnGrowth = finite(turns?.growth_rate, 0)
  const turnMax = Math.max(turnInitial, positive(finite(turns?.absolute_max, turnInitial)))
  const turnBudget = Math.min(turnMax, turnInitial + Math.max(0, turnGrowth) * (safeAttempt - 1))

  const tokenInitial = positive(finite(tokens?.initial, 100_000))
  const tokenGrowth = Math.max(1, finite(tokens?.growth_rate, 1))
  const tokenMax = Math.max(tokenInitial, positive(finite(tokens?.absolute_max, tokenInitial)))
  const tokenBudget = Math.min(
    tokenMax,
    Math.floor(tokenInitial * Math.pow(tokenGrowth, safeAttempt - 1))
  )

  return {
    turns: turnBudget,
    tokens: tokenBudget,
    maxToolCalls: positive(finite(limits?.max_tool_calls, turnBudget * 8)),
    wallClockSeconds: positive(finite(limits?.wall_clock_seconds, 3_600)),
    maxViolations: positive(finite(limits?.max_violations, 3)),
  }
}

export function emptyUsage(): Usage {
  return { turns: 0, toolCalls: 0, tokens: 0, elapsedSeconds: 0, violations: 0 }
}

export function remainingBudget(budget: EffectiveBudget, usage: Usage) {
  return {
    turns: Math.max(0, budget.turns - usage.turns),
    tokens: Math.max(0, budget.tokens - usage.tokens),
    toolCalls: Math.max(0, budget.maxToolCalls - usage.toolCalls),
    seconds: Math.max(0, budget.wallClockSeconds - usage.elapsedSeconds),
  }
}

export function budgetExceeded(budget: EffectiveBudget, usage: Usage): string | undefined {
  // `usage.turns` counts turns that have started, so the current turn is
  // still usable. A step with a one-turn budget must be able to make its
  // first tool call; it is blocked when the next turn starts.
  if (usage.turns > budget.turns) return 'turn limit reached'
  if (usage.tokens >= budget.tokens) return 'token limit reached'
  if (usage.toolCalls >= budget.maxToolCalls) return 'tool-call limit reached'
  if (usage.elapsedSeconds >= budget.wallClockSeconds) return 'wall-clock limit reached'
  if (usage.violations >= budget.maxViolations) return 'violation limit reached'
  return undefined
}
