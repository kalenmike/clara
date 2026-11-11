import { describe, expect, it } from 'vitest'
import type {
  ClaraPermissionRequest,
  ClaraSessionMessageAssistant,
  ClaraSessionMessageAssistantTool,
  ClaraSessionMessage,
} from '@clara/api-contract'
import { findPermissionThinking } from './permission-thinking'

function assistant(
  id: string,
  content: ClaraSessionMessageAssistant['content'],
  created = 3
): ClaraSessionMessageAssistant {
  return {
    id,
    type: 'assistant',
    time: { created },
    agent: 'build',
    model: { id: 'model', providerID: 'provider' },
    content,
  }
}

function reasoning(text: string) {
  return { type: 'reasoning' as const, text }
}

function tool(id: string): ClaraSessionMessageAssistantTool {
  return {
    type: 'tool',
    id,
    name: 'bash',
    time: { created: 4 },
    state: { status: 'running', input: {}, metadata: {} },
  }
}

function request(source?: ClaraPermissionRequest['source']): ClaraPermissionRequest {
  return {
    id: 'permission-1',
    sessionID: 'session-1',
    action: 'bash',
    resources: ['rm -rf build'],
    source,
  }
}

function source(messageID: string, id: string): ClaraPermissionRequest['source'] {
  return { type: 'tool', messageID, id }
}

describe('findPermissionThinking', () => {
  it('returns reasoning before the tool that asked for permission', () => {
    const messages: ClaraSessionMessage[] = [
      assistant('assistant-1', [
        reasoning('Check the build output first.'),
        reasoning('The stale directory blocks the rebuild.'),
        tool('tool-1'),
        reasoning('This runs after approval and is not relevant.'),
      ]),
    ]

    expect(findPermissionThinking(messages, request(source('assistant-1', 'tool-1')))).toBe(
      'Check the build output first.\n\nThe stale directory blocks the rebuild.'
    )
  })

  it('ignores reasoning from a different assistant step', () => {
    const messages: ClaraSessionMessage[] = [
      assistant('assistant-old', [reasoning('Old plan.')], 2),
      assistant('assistant-new', [reasoning('New reason.'), tool('tool-1')], 3),
    ]

    expect(findPermissionThinking(messages, request(source('assistant-new', 'tool-1')))).toBe(
      'New reason.'
    )
  })

  it('falls back to the newest assistant step without a source', () => {
    const messages: ClaraSessionMessage[] = [
      assistant('assistant-old', [reasoning('Old reason.')], 2),
      assistant('assistant-new', [reasoning('Newest reason.')], 3),
    ]

    expect(findPermissionThinking(messages, request())).toBe('Newest reason.')
  })

  it('falls back to the whole step when the tool is not found', () => {
    const messages: ClaraSessionMessage[] = [
      assistant('assistant-1', [reasoning('Reason one.'), reasoning('Reason two.')]),
    ]

    expect(findPermissionThinking(messages, request(source('assistant-1', 'missing')))).toBe(
      'Reason one.\n\nReason two.'
    )
  })

  it('returns an empty string when there is no reasoning', () => {
    const messages: ClaraSessionMessage[] = [
      assistant('assistant-1', [{ type: 'text', text: 'Done.' }, reasoning('   ')]),
    ]

    expect(findPermissionThinking(messages, request(source('assistant-1', 'tool-1')))).toBe('')
  })

  it('returns an empty string without any assistant message', () => {
    expect(findPermissionThinking([], request(source('assistant-1', 'tool-1')))).toBe('')
  })
})
