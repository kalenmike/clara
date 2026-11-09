import assert from 'node:assert/strict'
import test from 'node:test'
import {
  budgetTokenDelta,
  budgetTokenTotal,
  tokenDelta,
  tokensFromEvent,
  tokenTotal,
} from './usage.ts'

test('sums every model token field', () => {
  assert.equal(
    tokenTotal({
      input: 1_000,
      output: 200,
      reasoning: 50,
      cache: { read: 300, write: 25 },
    }),
    1_575
  )
})

test('uses a reported total when it is larger than the fields', () => {
  assert.equal(tokenTotal({ input: 10, total: 25 }), 25)
})

test('ignores missing, negative, and non-finite values', () => {
  assert.equal(tokenTotal(undefined), 0)
  assert.equal(tokenTotal({ input: -5, output: Number.NaN, reasoning: Infinity }), 0)
})

test('weights cached tokens down for budget enforcement', () => {
  assert.equal(
    budgetTokenTotal({
      input: 1_000,
      output: 200,
      reasoning: 50,
      cache: { read: 3_000, write: 0 },
    }),
    1_550
  )
  assert.equal(budgetTokenTotal({ input: 10, cache: { read: 4 }, total: 99 }), 11)
  assert.equal(budgetTokenTotal({ total: 42 }), 42)
  assert.equal(budgetTokenTotal(undefined), 0)
})

test('tracks a separate cache-weighted high-water mark per message', () => {
  const seen = new Map<string, number>()
  const usage = { input: 100, output: 20, cache: { read: 1_000 } }
  assert.equal(budgetTokenDelta(seen, 'msg_1', usage), 220)
  assert.equal(budgetTokenDelta(seen, 'msg_1', usage), 0)
  assert.equal(budgetTokenDelta(seen, 'msg_1', { ...usage, output: 40 }), 20)
})

test('counts a message once when the same usage arrives twice', () => {
  const seen = new Map<string, number>()
  const usage = { input: 100, output: 20 }
  assert.equal(tokenDelta(seen, 'msg_1', usage), 120)
  assert.equal(tokenDelta(seen, 'msg_1', usage), 0)
})

test('counts only the growth of a streaming message', () => {
  const seen = new Map<string, number>()
  assert.equal(tokenDelta(seen, 'msg_1', { input: 100, output: 10 }), 110)
  assert.equal(tokenDelta(seen, 'msg_1', { input: 100, output: 40 }), 30)
  assert.equal(tokenDelta(seen, 'msg_1', { input: 100, output: 40 }), 0)
})

test('keeps messages independent', () => {
  const seen = new Map<string, number>()
  assert.equal(tokenDelta(seen, 'msg_1', { input: 50 }), 50)
  assert.equal(tokenDelta(seen, 'msg_2', { input: 25 }), 25)
  assert.equal(tokenDelta(seen, 'msg_1', { input: 75 }), 25)
})

test('ignores an empty message id', () => {
  const seen = new Map<string, number>()
  assert.equal(tokenDelta(seen, '', { input: 50 }), 0)
  assert.equal(seen.size, 0)
})

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
