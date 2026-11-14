import type {
  SDKAssistantMessage,
  SDKPartialAssistantMessage,
} from '@anthropic-ai/claude-agent-sdk'
import { describe, expect, it } from 'vitest'
import { ClaudeStreamTranslator } from '../src/stream.ts'

const SESSION = '11111111-1111-4111-8111-111111111111'

function stream(event: unknown, uuid: string): SDKPartialAssistantMessage {
  return {
    type: 'stream_event',
    event,
    parent_tool_use_id: null,
    uuid,
    session_id: SESSION,
  } as SDKPartialAssistantMessage
}

function start(id: string) {
  return stream(
    {
      type: 'message_start',
      message: {
        id,
        type: 'message',
        role: 'assistant',
        model: 'claude-sonnet',
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
      },
    },
    'frame-start'
  )
}

function assistant(id: string, content: unknown[], uuid: string): SDKAssistantMessage {
  return {
    type: 'assistant',
    uuid,
    session_id: SESSION,
    parent_tool_use_id: null,
    message: {
      id,
      type: 'message',
      role: 'assistant',
      model: 'claude-sonnet',
      content,
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 },
    },
  } as SDKAssistantMessage
}

describe('Claude stream translation', () => {
  it('uses one assistant ID across frames that carry different wrapper UUIDs', () => {
    const translator = new ClaudeStreamTranslator()
    const events = [
      ...translator.streamEvent(start('msg_1')),
      ...translator.streamEvent(
        stream(
          { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
          'frame-a'
        )
      ),
      ...translator.streamEvent(
        stream(
          {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'text_delta', text: 'Hello' },
          },
          'frame-b'
        )
      ),
      ...translator.streamEvent(
        stream(
          {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'text_delta', text: ' world' },
          },
          'frame-c'
        )
      ),
      ...translator.streamEvent(stream({ type: 'content_block_stop', index: 0 }, 'frame-d')),
      ...translator.streamEvent(stream({ type: 'message_stop' }, 'frame-e')),
    ]

    expect(events[0]).toMatchObject({ type: 'message-start', assistantMessageID: 'msg_1' })
    const ids = events.flatMap((event) =>
      'assistantMessageID' in event ? [event.assistantMessageID] : []
    )
    expect(new Set(ids)).toEqual(new Set(['msg_1']))
    expect(events.filter((event) => event.type === 'text-delta')).toMatchObject([
      { delta: 'Hello' },
      { delta: ' world' },
    ])
    expect(events).toContainEqual({
      type: 'text-ended',
      assistantMessageID: 'msg_1',
      ordinal: 0,
      text: 'Hello world',
    })
  })

  it('keeps block ordinals and emits reasoning before text', () => {
    const translator = new ClaudeStreamTranslator()
    const events = [
      ...translator.streamEvent(start('msg_2')),
      ...translator.streamEvent(
        stream(
          {
            type: 'content_block_start',
            index: 0,
            content_block: { type: 'thinking', thinking: '' },
          },
          'thinking-start'
        )
      ),
      ...translator.streamEvent(
        stream(
          {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'thinking_delta', thinking: 'Let me think' },
          },
          'thinking-delta'
        )
      ),
      ...translator.streamEvent(
        stream(
          { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
          'text-start'
        )
      ),
      ...translator.streamEvent(
        stream(
          {
            type: 'content_block_delta',
            index: 1,
            delta: { type: 'text_delta', text: 'Hello' },
          },
          'text-delta'
        )
      ),
      ...translator.streamEvent(stream({ type: 'content_block_stop', index: 1 }, 'text-stop')),
      ...translator.streamEvent(stream({ type: 'content_block_stop', index: 0 }, 'thinking-stop')),
    ]

    expect(events).toContainEqual({
      type: 'reasoning-ended',
      assistantMessageID: 'msg_2',
      ordinal: 0,
      text: 'Let me think',
    })
    expect(events).toContainEqual({
      type: 'text-ended',
      assistantMessageID: 'msg_2',
      ordinal: 1,
      text: 'Hello',
    })
  })

  it('closes blocks when the stream stops without a block stop', () => {
    const translator = new ClaudeStreamTranslator()
    const events = [
      ...translator.streamEvent(start('msg_3')),
      ...translator.streamEvent(
        stream(
          { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
          'frame-a'
        )
      ),
      ...translator.streamEvent(
        stream(
          {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'text_delta', text: 'partial' },
          },
          'frame-b'
        )
      ),
      ...translator.streamEvent(stream({ type: 'message_stop' }, 'frame-c')),
    ]

    expect(events).toContainEqual({
      type: 'text-ended',
      assistantMessageID: 'msg_3',
      ordinal: 0,
      text: 'partial',
    })
  })

  it('attributes completed blocks and tools to the API message ID', () => {
    const translator = new ClaudeStreamTranslator()
    const events = translator.assistant(
      assistant(
        'msg_4',
        [
          { type: 'text', text: 'Checking' },
          { type: 'tool_use', id: 'tool-1', name: 'Bash', input: { command: 'ls' } },
        ],
        'block-a'
      ),
      false
    )

    expect(events).toContainEqual({
      type: 'tool-called',
      assistantMessageID: 'msg_4',
      toolID: 'tool-1',
      input: { command: 'ls' },
    })
    expect(events.at(-1)).toMatchObject({
      type: 'assistant',
      assistantMessageID: 'msg_4',
      content: [
        { type: 'text', text: 'Checking' },
        { type: 'tool_use', id: 'tool-1', name: 'Bash' },
      ],
    })
  })
})
