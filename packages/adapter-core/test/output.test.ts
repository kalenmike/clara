import assert from 'node:assert/strict'
import test from 'node:test'
import { capToolResult, TOOL_OUTPUT_LIMIT, truncateToolOutput } from '../src/output.ts'

test('leaves a short tool result unchanged', () => {
  const text = 'src/runtime.ts:42: budget check'
  assert.equal(truncateToolOutput(text), text)
})

test('truncates a long tool result and marks the omission', () => {
  const text = 'a'.repeat(TOOL_OUTPUT_LIMIT * 2)
  const capped = truncateToolOutput(text)
  assert.ok(capped.length < text.length)
  assert.match(capped, /characters truncated by Clara/)
  assert.ok(capped.startsWith('a'.repeat(1_000)))
  assert.ok(capped.endsWith('a'.repeat(1_000)))
})

test('caps the output string and text parts in a completed event', () => {
  const huge = { type: 'text', text: 't'.repeat(TOOL_OUTPUT_LIMIT + 10) }
  const small = { type: 'text', text: 'kept' }
  const file = { type: 'file', uri: 'file:///tmp/a.png', mime: 'image/png' }
  const event = {
    status: 'completed',
    result: {
      output: 'o'.repeat(TOOL_OUTPUT_LIMIT + 10),
      content: [huge, small, file],
      metadata: { exit: 0 },
    },
  }
  assert.equal(capToolResult(event), true)
  assert.ok(event.result.output.length <= TOOL_OUTPUT_LIMIT + 200)
  assert.equal(file.uri, 'file:///tmp/a.png')
  assert.deepEqual(event.result.metadata, { exit: 0 })
  assert.ok(huge.text.includes('truncated by Clara'))
})

test('does nothing for an event without a result', () => {
  assert.equal(capToolResult({ status: 'error', error: { error: new Error('no') } }), false)
  assert.equal(capToolResult(undefined), false)
})
