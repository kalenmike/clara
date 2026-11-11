import { describe, expect, it } from 'vitest'
import type {
  ClaraSessionMessageAssistant,
  ClaraSessionMessage,
  ClaraSessionMessageUser,
} from '@clara/api-contract'
import { planMessageFork } from './fork'

function user(id: string, text: string, created = 1): ClaraSessionMessageUser {
  return { id, type: 'user', time: { created }, text }
}

function assistant(id: string, created = 2): ClaraSessionMessageAssistant {
  return {
    id,
    type: 'assistant',
    time: { created },
    agent: 'build',
    model: { id: 'model', providerID: 'provider' },
    content: [{ type: 'text', text: 'reply' }],
  }
}

describe('planMessageFork', () => {
  const first = user('user-1', 'first', 1)
  const reply = assistant('assistant-2', 2)
  const second = user('user-3', 'second', 3)
  const messages: ClaraSessionMessage[] = [first, reply, second]

  it('forks through a middle message using the next sibling as the boundary', () => {
    expect(planMessageFork(messages, 'assistant-2')).toEqual({ before: 'user-3' })
  })

  it('copies the full history when the selected message is newest', () => {
    expect(planMessageFork(messages, 'user-3')).toEqual({})
  })

  it('includes the first message', () => {
    expect(planMessageFork([first, reply], 'user-1')).toEqual({ before: 'assistant-2' })
  })

  it('returns null for unknown or non-conversational messages', () => {
    expect(planMessageFork(messages, 'missing')).toBeNull()
    expect(
      planMessageFork(
        [{ id: 'idle-1', type: 'idle', time: { created: 1 }, outcome: 'succeeded' }, first],
        'idle-1'
      )
    ).toBeNull()
  })
})
