import { describe, expect, it } from 'vitest'
import type {
  SessionMessageAssistant,
  SessionMessageAssistantTool,
  SessionMessageInfo,
  SessionMessageSynthetic,
} from '@opencode/client'
import { findLatestPlanRequest, planRequestProgress, type PlanRequest } from './plan-request'

function request(created = 1, kind: 'plan-request' | 'plan-update' = 'plan-update') {
  return {
    id: `request-${created}`,
    time: { created },
    type: 'synthetic',
    text: '',
    metadata: { clara: { kind } },
  } satisfies SessionMessageSynthetic
}

function assistant(
  created: number,
  content: SessionMessageAssistant['content'] = []
): SessionMessageAssistant {
  return {
    id: `assistant-${created}`,
    type: 'assistant',
    time: { created },
    agent: 'build',
    model: { id: 'model', providerID: 'provider' },
    content,
  }
}

function tool(name: string, created: number, id = name): SessionMessageAssistantTool {
  return {
    type: 'tool',
    id,
    name,
    time: { created },
    state: { status: 'running', input: {}, metadata: {} },
  }
}

describe('findLatestPlanRequest', () => {
  it('finds the newest plan request or update', () => {
    const messages = [
      request(1, 'plan-request'),
      request(2, 'plan-update'),
      {
        id: 'other',
        type: 'synthetic',
        time: { created: 3 },
        text: '',
        metadata: { clara: { kind: 'build-start' } },
      } satisfies SessionMessageSynthetic,
    ]

    expect(findLatestPlanRequest(messages)).toEqual({ id: 'request-2', time: 2 })
  })

  it('returns undefined without a Clara plan request', () => {
    expect(findLatestPlanRequest([assistant(1)])).toBeUndefined()
  })
})

describe('planRequestProgress', () => {
  const asked: PlanRequest = { id: 'request-1', time: 10 }

  it('waits before the agent responds', () => {
    expect(planRequestProgress([request(10)], asked)).toBe('waiting')
  })

  it('unlocks when a todowrite call arrives', () => {
    const messages = [request(10), assistant(11, [tool('read', 11), tool('todowrite', 12)])]

    expect(planRequestProgress(messages, asked)).toBe('responded')
  })

  it('ignores a todowrite call before the request', () => {
    const messages = [assistant(9, [tool('todowrite', 9)]), request(10)]

    expect(planRequestProgress(messages, asked)).toBe('waiting')
  })

  it('times out after five assistant messages', () => {
    const messages: SessionMessageInfo[] = [request(10)]
    for (let index = 1; index <= 5; index += 1) {
      messages.push(assistant(10 + index))
    }

    expect(planRequestProgress(messages, asked)).toBe('timed-out')
  })

  it('counts assistant messages and tool calls together', () => {
    const messages = [
      request(10),
      assistant(11, [tool('read', 11), tool('grep', 11)]),
      assistant(12, [tool('bash', 12)]),
      assistant(13),
    ]

    expect(planRequestProgress(messages, asked)).toBe('timed-out')
  })

  it('still counts an unanswered request that is not in the transcript', () => {
    const messages = [request(10), assistant(14)]

    expect(planRequestProgress(messages, { id: 'local', time: 12 })).toBe('waiting')
  })

  it('uses tool creation time for a request that is not in the transcript', () => {
    const messages = [request(10), assistant(13, [tool('todowrite', 13)])]

    expect(planRequestProgress(messages, { id: 'local', time: 12 })).toBe('responded')
  })
})
