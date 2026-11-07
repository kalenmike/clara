import { describe, expect, it } from 'vitest'
import { budgetExceeded, computeBudget, emptyUsage, evaluatePolicy, matches } from '../src/index.ts'

describe('glob matching', () => {
  it('matches paths and commands', () => {
    expect(matches('src/app.ts', 'src/**')).toBe(true)
    expect(matches('src/app.ts', 'tests/**')).toBe(false)
    expect(matches('git status --short', 'git *')).toBe(true)
    expect(matches('git push origin main', 'git status')).toBe(false)
  })
})

describe('computeBudget', () => {
  it('grows turns additively and tokens multiplicatively', () => {
    expect(
      computeBudget({ turns: { initial: 4, growth_rate: 2, absolute_max: 10 } }, 3).turns
    ).toBe(8)
    expect(
      computeBudget({ tokens: { initial: 1_000, growth_rate: 1.5, absolute_max: 2_000 } }, 3).tokens
    ).toBe(2_000)
  })
})

describe('evaluatePolicy', () => {
  const budget = computeBudget({ turns: { initial: 2 } })

  it('denies tools outside the allowlist and paths outside scope', () => {
    const policy = {
      tools: { allow: ['read', 'edit', 'shell'] },
      edit: { allow: ['src/**', 'tests/**'] },
      shell: { allow: ['pnpm *'] },
    }
    expect(
      evaluatePolicy(policy, budget, emptyUsage(), {
        action: 'edit',
        tool: 'edit',
        resources: ['src/a.ts'],
      }).effect
    ).toBe('allow')
    expect(
      evaluatePolicy(policy, budget, emptyUsage(), {
        action: 'edit',
        tool: 'edit',
        resources: ['.env'],
      }).effect
    ).toBe('deny')
    expect(
      evaluatePolicy(policy, budget, emptyUsage(), {
        action: 'shell',
        tool: 'shell',
        command: 'rm -rf /',
      }).effect
    ).toBe('deny')
  })

  it('blocks when the turn budget is exhausted', () => {
    const usage = { ...emptyUsage(), turns: 2 }
    expect(budgetExceeded(budget, usage)).toBe('turn limit reached')
    expect(evaluatePolicy(undefined, budget, usage, { action: 'read', tool: 'read' }).effect).toBe(
      'deny'
    )
  })
})
