export type EnforcementMode = 'observed' | 'strict' | 'sandboxed'

export type Effect = 'allow' | 'deny' | 'ask'

export interface PermissionRule {
  action: string
  resource: string
  effect: Effect
}

export interface PolicyRuleSet {
  allow?: string[]
  deny?: string[]
}

export interface StepPolicy {
  tools?: PolicyRuleSet
  edit?: PolicyRuleSet
  shell?: PolicyRuleSet
  network?: PolicyRuleSet
  subagents?: 'managed' | 'deny' | 'allow'
  rules?: PermissionRule[]
}

export interface TurnLimit {
  initial: number
  growth_rate?: number
  absolute_max?: number
  enforce?: 'hard' | 'soft'
}

export interface TokenLimit {
  initial: number
  growth_rate?: number
  absolute_max?: number
  enforce?: 'hard' | 'soft'
}

export interface Limits {
  turns?: TurnLimit
  tokens?: TokenLimit
  max_tool_calls?: number
  wall_clock_seconds?: number
  max_violations?: number
  /**
   * What to do when a worker that ran out of budget reports a result. `keep`
   * accepts the over-budget result and advances (the historical behavior);
   * `fail` treats the attempt as unfinished so it retries with a larger budget
   * and the worker's handoff in context.
   */
  on_exhausted?: 'keep' | 'fail'
}

export interface Usage {
  turns: number
  toolCalls: number
  tokens: number
  /** Cache-weighted tokens for budget enforcement; falls back to `tokens`. */
  budgetTokens?: number
  elapsedSeconds: number
  violations: number
}

export interface EffectiveBudget {
  turns: number
  tokens: number
  maxToolCalls: number
  wallClockSeconds: number
  maxViolations: number
}

export interface PolicyCheck {
  action: string
  tool?: string
  resources?: string[]
  command?: string
  network?: string
}

export interface PolicyDecision {
  effect: Effect
  reason?: string
  remaining: {
    turns: number
    tokens: number
    toolCalls: number
    seconds: number
  }
  /** Total violations recorded for the step after this decision. */
  violations?: number
  /** Set when the denial comes from a resource budget (hard limit or reserve). */
  budgetExhausted?: string
  /** The step is no longer running (it was retried or failed). */
  closed?: boolean
}
