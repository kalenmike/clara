import { describe, expect, it } from 'vitest'
import type { SessionMessageAssistant, SessionMessageAssistantTool } from '@opencode/client'
import { formatUsageDetail, formatUsageSummary, hasUsage, summarizeSteps } from './usage-summary'

function step(
  content: SessionMessageAssistant['content'],
  tokens?: SessionMessageAssistant['tokens'],
  cost?: number
): SessionMessageAssistant {
  return {
    id: 'assistant-1',
    type: 'assistant',
    time: { created: 1 },
    agent: 'build',
    model: { id: 'model', providerID: 'provider' },
    content,
    tokens,
    cost,
  }
}

function tool(): SessionMessageAssistantTool {
  return {
    type: 'tool',
    id: 'tool-1',
    name: 'read',
    time: { created: 1, completed: 2 },
    state: {
      status: 'completed',
      input: {},
      content: [{ type: 'text', text: 'ok' }],
      metadata: {},
    },
  }
}

describe('summarizeSteps', () => {
  it('sums reasoning, tokens, cost, tools, and turns', () => {
    const summary = summarizeSteps([
      step(
        [{ type: 'reasoning', text: 'plan' }, tool()],
        { input: 100, output: 10, reasoning: 2, cache: { read: 0, write: 0 } },
        0.01
      ),
      step([{ type: 'text', text: 'Done' }], {
        input: 50,
        output: 5,
        reasoning: 0,
        cache: { read: 0, write: 0 },
      }),
    ])

    expect(summary).toEqual({
      chars: 4,
      input: 150,
      output: 15,
      cost: 0.01,
      costEstimated: false,
      tools: 1,
      turns: 2,
      hasTokens: true,
    })
  })

  it('uses an estimator and marks the cost as estimated', () => {
    const summary = summarizeSteps(
      [
        step([{ type: 'text', text: 'Done' }], {
          input: 100,
          output: 10,
          reasoning: 0,
          cache: { read: 0, write: 0 },
        }),
      ],
      { estimateCost: () => 0.02 }
    )

    expect(summary.cost).toBe(0.02)
    expect(summary.costEstimated).toBe(true)
    expect(formatUsageSummary(summary)).toContain('~$0.020')
  })

  it('falls back to the reported step cost when the estimator has no price', () => {
    const summary = summarizeSteps(
      [
        step(
          [{ type: 'text', text: 'Done' }],
          { input: 100, output: 10, reasoning: 0, cache: { read: 0, write: 0 } },
          0.01
        ),
      ],
      { estimateCost: () => undefined }
    )

    expect(summary.cost).toBe(0.01)
    expect(summary.costEstimated).toBe(true)
  })

  it('handles a step with no tokens or usage yet', () => {
    const summary = summarizeSteps([step([{ type: 'reasoning', text: 'waiting' }])])

    expect(summary).toMatchObject({
      chars: 7,
      input: 0,
      output: 0,
      cost: 0,
      costEstimated: false,
      tools: 0,
      turns: 1,
      hasTokens: false,
    })
    expect(hasUsage(summary)).toBe(true)
  })
})

describe('formatUsageSummary', () => {
  it('keeps tokens and cost before the hidden-work counts', () => {
    const text = formatUsageSummary({
      chars: 812,
      input: 1_800,
      output: 720,
      cost: 0.007,
      costEstimated: false,
      tools: 3,
      turns: 3,
      hasTokens: true,
    })

    expect(text).toContain('1.8K in')
    expect(text).toContain('720 out')
    expect(text).toContain('$0.007')
    expect(text).toContain('812 chars')
    expect(text).toContain('3 tools')
    expect(text).toContain('3 turns')
  })

  it('pluralizes one tool and one turn', () => {
    const text = formatUsageSummary({
      chars: 0,
      input: 0,
      output: 0,
      cost: 0,
      costEstimated: false,
      tools: 1,
      turns: 1,
      hasTokens: false,
    })

    expect(text).toBe('1 tool · 1 turn')
  })
})

describe('formatUsageDetail', () => {
  it('leaves the thinking character count out of the footer detail', () => {
    const text = formatUsageDetail({
      chars: 812,
      input: 1_800,
      output: 720,
      cost: 0.007,
      costEstimated: false,
      tools: 3,
      turns: 3,
      hasTokens: true,
    })

    expect(text).toContain('1.8K in')
    expect(text).toContain('720 out')
    expect(text).toContain('$0.007')
    expect(text).toContain('3 tools')
    expect(text).toContain('3 turns')
    expect(text).not.toContain('chars')
  })
})
