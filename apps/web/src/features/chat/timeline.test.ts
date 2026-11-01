import { describe, expect, it } from 'vitest'
import type {
  SessionMessageAssistant,
  SessionMessageAssistantTool,
  SessionMessageInfo,
  SessionMessageSynthetic,
  SessionMessageUser,
} from '@opencode/client'
import { getVisibleMessages } from './message-visibility'
import { buildTimeline } from './timeline'

function user(text: string, created = 1): SessionMessageUser {
  return { id: `user-${created}`, type: 'user', time: { created }, text }
}

function synthetic(
  description: string | undefined,
  metadata: SessionMessageSynthetic['metadata'],
  created = 2
): SessionMessageSynthetic {
  return {
    id: `synthetic-${created}`,
    type: 'synthetic',
    time: { created },
    text: 'model text',
    description,
    metadata,
  }
}

function assistant(
  content: SessionMessageAssistant['content'],
  created = 3
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

function questionTool(
  answers: string[][] | undefined,
  status: 'completed' | 'error' = 'completed'
): SessionMessageAssistantTool {
  const input = {
    questions: [
      { header: 'Runtime', question: 'Which runtime?' },
      { header: 'Features', question: 'Which features?' },
    ],
  }
  return {
    type: 'tool',
    id: 'question-1',
    name: 'question',
    time: { created: 3, completed: 4 },
    state:
      status === 'completed'
        ? {
            status,
            input,
            content: [{ type: 'text', text: 'ok' }],
            metadata: answers ? { answers } : {},
          }
        : {
            status,
            input,
            error: { type: 'aborted', message: 'dismissed' },
            metadata: {},
          },
  }
}

function timeline(messages: SessionMessageInfo[], showInternal = false, streaming = false) {
  return buildTimeline(getVisibleMessages(messages, showInternal, streaming), {
    showInternal,
    streaming,
  })
}

describe('buildTimeline', () => {
  it('renders Clara synthetic input as a system event', () => {
    const items = timeline([synthetic('Requested a plan', { clara: { kind: 'plan-request' } })])

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      type: 'event',
      event: { kind: 'plan-request', label: 'Requested a plan', time: 2 },
    })
  })

  it('keeps untagged synthetic messages behind the internal toggle', () => {
    const messages = [synthetic('Background job finished', undefined)]

    expect(timeline(messages)).toEqual([])
    expect(timeline(messages, true)).toEqual([
      { type: 'message', key: 'message:synthetic-2', message: messages[0] },
    ])
  })

  it('turns a question-only assistant turn into an answer event', () => {
    const items = timeline([assistant([questionTool([['Bun'], ['TypeScript']])])])

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      type: 'event',
      event: {
        kind: 'question-answer',
        label: 'Answered 2 questions',
        time: 4,
      },
    })
    expect(items[0]?.type === 'event' ? items[0].event.detail : '').toContain(
      'Q: Which runtime?\nA: Bun'
    )
  })

  it('keeps assistant text and appends the answer event', () => {
    const items = timeline([
      assistant([{ type: 'text', text: 'I need two details.' }, questionTool([['Bun'], []])]),
    ])

    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({ type: 'message' })
    if (items[0]?.type === 'message' && items[0].message.type === 'assistant') {
      expect(items[0].message.content).toHaveLength(1)
      expect(items[0].message.content[0]).toMatchObject({ type: 'text' })
    }
    expect(items[1]).toMatchObject({
      type: 'event',
      event: { label: 'Answered 1 question' },
    })
    expect(items[1]?.type === 'event' ? items[1].event.detail : '').toContain(
      'Q: Which features?\nA: Unanswered'
    )
  })

  it('labels a cancelled question as dismissed', () => {
    const items = timeline([assistant([questionTool(undefined, 'error')])])

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      type: 'event',
      event: { kind: 'question-dismissed', label: 'Question dismissed' },
    })
  })

  it('does not emit an answer event while the question is running', () => {
    const running: SessionMessageAssistantTool = {
      ...questionTool(undefined),
      state: {
        status: 'running',
        input: { questions: [{ question: 'Which runtime?' }] },
        metadata: {},
      },
    }
    const items = timeline([assistant([running])], false, true)

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ type: 'message' })
  })

  it('leaves ordinary conversation untouched', () => {
    const messages = [user('Hello'), assistant([{ type: 'text', text: 'Hi' }])]
    const items = timeline(messages)

    expect(items.map((item) => item.type)).toEqual(['message', 'message'])
    expect(items.map((item) => (item.type === 'message' ? item.message.id : ''))).toEqual([
      'user-1',
      'assistant-3',
    ])
  })
})
