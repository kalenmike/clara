import { describe, expect, it } from 'vitest'
import type { JsonValue, SessionMessageAssistant } from '@opencode/client'
import { findPlanTodos } from './session-plan'

function assistant(content: SessionMessageAssistant['content']): SessionMessageAssistant {
  return {
    id: 'message',
    type: 'assistant',
    time: { created: 1 },
    agent: 'plan',
    model: { id: 'model', providerID: 'provider' },
    content,
  }
}

function todoCall(
  todos: JsonValue[],
  status: 'completed' | 'running' = 'completed'
): SessionMessageAssistant['content'][number] {
  return {
    type: 'tool',
    id: 'todo',
    name: 'todowrite',
    time: { created: 1 },
    state:
      status === 'completed'
        ? { status, input: { todos }, content: [{ type: 'text', text: 'ok' }] }
        : { status, input: { todos }, metadata: {} },
  }
}

describe('findPlanTodos', () => {
  it('reads the newest completed todowrite call', () => {
    const messages = [
      assistant([todoCall([{ content: 'Old', status: 'pending', priority: 'low' }])]),
      assistant([todoCall([{ content: 'New', status: 'in_progress', priority: 'high' }])]),
    ]

    expect(findPlanTodos(messages)).toEqual([{ content: 'New', status: 'in_progress' }])
  })

  it('treats an empty list as a cleared plan', () => {
    expect(findPlanTodos([assistant([todoCall([])])])).toEqual([])
  })

  it('skips running calls', () => {
    const messages = [
      assistant([todoCall([{ content: 'Old', status: 'completed' }])]),
      assistant([todoCall([{ content: 'Running', status: 'pending' }], 'running')]),
    ]

    expect(findPlanTodos(messages)).toEqual([{ content: 'Old', status: 'completed' }])
  })

  it('skips malformed todo entries', () => {
    const messages = [
      assistant([
        todoCall([
          { nope: true },
          { content: 'Valid', status: 'pending' },
          { content: 'Bad status', status: 'archived' },
        ]),
      ]),
    ]

    expect(findPlanTodos(messages)).toEqual([{ content: 'Valid', status: 'pending' }])
  })

  it('returns undefined without a todo plan', () => {
    expect(findPlanTodos([])).toBeUndefined()
  })
})
