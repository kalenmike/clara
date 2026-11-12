import { describe, expect, it } from 'vitest'
import {
  assistantHasFailed,
  isFinishedPlanReply,
  resolveAttentionKind,
  type SessionMailboxSignals,
} from '../src/index.ts'

const base: SessionMailboxSignals = {
  last: 'assistant',
  awaitingInput: false,
  lastError: false,
  planReply: false,
}

describe('resolveAttentionKind', () => {
  it('puts a pending question above every other state', () => {
    expect(resolveAttentionKind({ ...base, lastError: true }, 'build', true)).toBe('question')
    expect(resolveAttentionKind({ ...base, awaitingInput: true }, 'plan', false)).toBe('question')
  })

  it('categorizes a finished reply by its failure and plan state', () => {
    expect(resolveAttentionKind({ ...base, lastError: true }, 'build', false)).toBe('error')
    expect(resolveAttentionKind({ ...base, planReply: true }, 'plan', false)).toBe('plan')
    expect(resolveAttentionKind({ ...base, planReply: true }, 'build', false)).toBe('review')
    expect(resolveAttentionKind(base, 'build', false)).toBe('review')
  })

  it('does not alert when the person replied last or the session is empty', () => {
    expect(resolveAttentionKind({ ...base, last: 'user' }, 'build', false)).toBeNull()
    expect(resolveAttentionKind({ ...base, last: 'none' }, 'build', false)).toBeNull()
    expect(resolveAttentionKind(undefined, 'build', false)).toBeNull()
  })
})

describe('message signals', () => {
  it('treats an error field or error finish as a failed turn', () => {
    expect(assistantHasFailed({ finish: 'error' })).toBe(true)
    expect(assistantHasFailed({ error: new Error('quota') })).toBe(true)
    expect(assistantHasFailed({ finish: 'stop' })).toBe(false)
  })

  it('only accepts a clean, finished Plan reply', () => {
    expect(isFinishedPlanReply({ agent: 'plan', finish: 'stop' })).toBe(true)
    expect(isFinishedPlanReply({ agent: 'plan', finish: 'length' })).toBe(false)
    expect(isFinishedPlanReply({ agent: 'build', finish: 'stop' })).toBe(false)
    expect(isFinishedPlanReply({ agent: 'plan', finish: 'stop', error: 'x' })).toBe(false)
  })
})
