import assert from 'node:assert/strict'
import test from 'node:test'
import { tokensFromEvent } from './usage-events.ts'

test('reads final usage from a session step event', () => {
  assert.deepEqual(
    tokensFromEvent({
      type: 'session.step.ended',
      data: {
        sessionID: 'ses_1',
        assistantMessageID: 'msg_1',
        tokens: { input: 100, output: 20, reasoning: 5, cache: { read: 30, write: 2 } },
      },
    }),
    {
      sessionID: 'ses_1',
      messageID: 'msg_1',
      usage: { input: 100, output: 20, reasoning: 5, cache: { read: 30, write: 2 } },
      final: true,
    }
  )
})

test('reads streaming usage from a message event', () => {
  assert.deepEqual(
    tokensFromEvent({
      type: 'message.updated',
      properties: {
        sessionID: 'ses_1',
        info: {
          role: 'assistant',
          id: 'msg_1',
          tokens: { input: 50, output: 5 },
          time: { completed: 1 },
        },
      },
    }),
    {
      sessionID: 'ses_1',
      messageID: 'msg_1',
      usage: { input: 50, output: 5 },
      final: true,
    }
  )
})

test('ignores events without assistant usage', () => {
  assert.equal(tokensFromEvent({ type: 'session.step.ended', data: {} }), undefined)
  assert.equal(
    tokensFromEvent({ type: 'message.updated', properties: { info: { role: 'user' } } }),
    undefined
  )
  assert.equal(tokensFromEvent({ type: 'session.status' }), undefined)
})
