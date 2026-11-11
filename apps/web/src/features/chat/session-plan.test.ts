import { describe, expect, it } from 'vitest'
import type { ClaraJsonValue, ClaraSessionMessageAssistant } from '@clara/api-contract'
import { findPlanTodos } from './session-plan'

function assistant(
  content: ClaraSessionMessageAssistant['content'],
  created = 1
): ClaraSessionMessageAssistant {
  return {
    id: 'message',
    type: 'assistant',
    time: { created },
    agent: 'plan',
    model: { id: 'model', providerID: 'provider' },
    content,
  }
}

function todoCall(
  todos: ClaraJsonValue[],
  status: 'completed' | 'running' = 'completed'
): ClaraSessionMessageAssistant['content'][number] {
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

  it('hides a plan inherited by a fork', () => {
    const messages = [assistant([todoCall([{ content: 'Parent', status: 'in_progress' }])], 100)]

    expect(findPlanTodos(messages, { forkedAt: 200 })).toBeUndefined()
  })

  it('reads a plan written in the fork', () => {
    const messages = [
      assistant([todoCall([{ content: 'Parent', status: 'completed' }])], 100),
      assistant([todoCall([{ content: 'Branch', status: 'in_progress' }])], 300),
    ]

    expect(findPlanTodos(messages, { forkedAt: 200 })).toEqual([
      { content: 'Branch', status: 'in_progress' },
    ])
  })

  it('keeps a plan written at the fork time', () => {
    const messages = [assistant([todoCall([{ content: 'Branch', status: 'pending' }])], 200)]

    expect(findPlanTodos(messages, { forkedAt: 200 })).toEqual([
      { content: 'Branch', status: 'pending' },
    ])
  })

  it('returns undefined without a todo plan', () => {
    expect(findPlanTodos([])).toBeUndefined()
  })
})
