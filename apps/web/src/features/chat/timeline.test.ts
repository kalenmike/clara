import { describe, expect, it } from 'vitest'
import type {
  SessionMessageAssistant,
  SessionMessageAssistantTool,
  SessionMessageInfo,
  SessionMessageSynthetic,
  SessionMessageUser,
} from '@opencode/client'
import { buildTimeline } from './timeline'

function user(text: string, created = 1): SessionMessageUser {
  return { id: `user-${created}`, type: 'user', time: { created }, text }
}

function synthetic(
  description: string | undefined,
  metadata: SessionMessageSynthetic['metadata'],
  created = 2,
  text = 'model text'
): SessionMessageSynthetic {
  return {
    id: `synthetic-${created}`,
    type: 'synthetic',
    time: { created },
    text,
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

function priced(
  message: SessionMessageAssistant,
  input: number,
  output: number,
  cost = 0
): SessionMessageAssistant {
  return {
    ...message,
    tokens: { input, output, reasoning: 0, cache: { read: 0, write: 0 } },
    cost,
  }
}

function toolPart(id: string): SessionMessageAssistantTool {
  return {
    type: 'tool',
    id,
    name: 'read',
    time: { created: 3, completed: 4 },
    state: {
      status: 'completed',
      input: {},
      content: [{ type: 'text', text: 'ok' }],
      metadata: {},
    },
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
  return buildTimeline(messages, { showInternal, streaming })
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

  it('renders a saved-draft start as a system event', () => {
    const items = timeline([
      synthetic('User confirmed. Starting saved draft.', { clara: { kind: 'draft-start' } }),
    ])

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      type: 'event',
      event: {
        kind: 'draft-start',
        label: 'User confirmed. Starting saved draft.',
        time: 2,
      },
    })
  })

  it('keeps a system reminder behind the internal toggle', () => {
    const message = synthetic(
      undefined,
      undefined,
      2,
      '<system-reminder>\nYou are in Plan mode.\n</system-reminder>'
    )
    const expected = [
      {
        type: 'event',
        key: 'event:synthetic-2',
        event: {
          id: 'synthetic-2',
          kind: 'system-reminder',
          label: 'System Reminder',
          detail: 'You are in Plan mode.',
          time: 2,
        },
      },
    ]

    expect(timeline([message])).toEqual([])
    expect(timeline([message], true)).toEqual(expected)
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

  it('rolls hidden steps into the next visible reply', () => {
    const hidden = priced(
      assistant([{ type: 'reasoning', text: 'planning' }, toolPart('tool-1')], 3),
      100,
      10,
      0.01
    )
    const reply = priced(assistant([{ type: 'text', text: 'Done' }], 4), 50, 5, 0.02)

    const items = timeline([user('Go'), hidden, reply])
    const message = items[1]

    expect(message?.type).toBe('message')
    if (message?.type !== 'message') return
    expect(message.message.id).toBe('assistant-4')
    expect(message.usageSummary).toEqual({
      chars: 8,
      input: 150,
      output: 15,
      cost: 0.03,
      tools: 1,
      turns: 2,
      hasTokens: true,
    })
  })

  it('gives each visible reply only the hidden work since the previous reply', () => {
    const firstHidden = priced(assistant([{ type: 'reasoning', text: 'first' }], 2), 10, 1)
    const firstReply = priced(assistant([{ type: 'text', text: 'First' }], 3), 20, 2)
    const secondHidden = priced(assistant([{ type: 'reasoning', text: 'second' }], 4), 30, 3)
    const secondReply = priced(assistant([{ type: 'text', text: 'Second' }], 5), 40, 4)

    const items = timeline([user('Go'), firstHidden, firstReply, secondHidden, secondReply])
    const messages = items.flatMap((item) =>
      item.type === 'message' && item.message.type === 'assistant' ? [item] : []
    )

    expect(messages.map((item) => item.message.id)).toEqual(['assistant-3', 'assistant-5'])
    expect(messages[0]?.usageSummary).toMatchObject({ turns: 2, input: 30, output: 3 })
    expect(messages[1]?.usageSummary).toMatchObject({ turns: 2, input: 70, output: 7 })
  })

  it('keeps a trailing thinking row for hidden work with no reply', () => {
    const hidden = priced(
      assistant([{ type: 'reasoning', text: 'working' }, toolPart('tool-1')], 3),
      100,
      10,
      0.01
    )

    const items = timeline([user('Go'), hidden])

    expect(items[1]).toMatchObject({
      type: 'hidden-activity',
      streaming: false,
      summary: { chars: 7, tools: 1, turns: 1, input: 100, output: 10, cost: 0.01 },
    })
  })

  it('marks a trailing thinking row as live while the run is streaming', () => {
    const hidden = assistant([{ type: 'reasoning', text: 'working' }], 3)
    const items = timeline([user('Go'), hidden], false, true)

    expect(items[1]).toMatchObject({
      type: 'hidden-activity',
      streaming: true,
      summary: { turns: 1 },
    })
  })

  it('includes hidden internals from a visible reply', () => {
    const reply = priced(
      assistant(
        [
          { type: 'reasoning', text: 'checking' },
          toolPart('tool-1'),
          { type: 'text', text: 'Done' },
        ],
        3
      ),
      50,
      5,
      0.02
    )

    const items = timeline([user('Go'), reply])

    expect(items[1]).toMatchObject({
      type: 'message',
      usageSummary: { chars: 8, tools: 1, turns: 1, input: 50, output: 5, cost: 0.02 },
    })
  })

  it('does not summarize when internal output is on', () => {
    const hidden = assistant([{ type: 'reasoning', text: 'planning' }], 3)
    const reply = assistant([{ type: 'text', text: 'Done' }], 4)

    const items = timeline([user('Go'), hidden, reply], true)

    expect(items.map((item) => item.type)).toEqual(['message', 'message', 'message'])
    expect(items.every((item) => item.type !== 'message' || !item.usageSummary)).toBe(true)
  })

  it('keeps the old footer for a plain reply', () => {
    const reply = priced(assistant([{ type: 'text', text: 'Done' }], 3), 50, 5, 0.02)
    const items = timeline([user('Go'), reply])

    expect(items[1]).toMatchObject({ type: 'message', usageSummary: undefined })
  })
})
