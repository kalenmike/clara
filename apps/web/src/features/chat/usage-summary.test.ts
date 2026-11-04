import { describe, expect, it } from 'vitest'
import type { SessionMessageAssistant, SessionMessageAssistantTool } from '@opencode/client'
import { formatUsageSummary, hasUsage, summarizeSteps } from './usage-summary'

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
      tools: 1,
      turns: 2,
      hasTokens: true,
    })
  })

  it('handles a step with no tokens or usage yet', () => {
    const summary = summarizeSteps([step([{ type: 'reasoning', text: 'waiting' }])])

    expect(summary).toMatchObject({
      chars: 7,
      input: 0,
      output: 0,
      cost: 0,
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
      tools: 1,
      turns: 1,
      hasTokens: false,
    })

    expect(text).toBe('1 tool · 1 turn')
  })
})
