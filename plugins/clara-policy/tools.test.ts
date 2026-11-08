import assert from 'node:assert/strict'
import test from 'node:test'
import { CONTROL_TOOL_OPTIONS, START_TOOL_INPUT } from './index.ts'

test('registers Clara control tools as native tools', () => {
  assert.equal(CONTROL_TOOL_OPTIONS.namespace, 'clara')
  assert.equal(CONTROL_TOOL_OPTIONS.codemode, false)
})

test('the interface start tool accepts only the request', () => {
  assert.deepEqual(Object.keys(START_TOOL_INPUT.properties), ['prompt'])
  assert.deepEqual(START_TOOL_INPUT.required, ['prompt'])
  assert.equal(START_TOOL_INPUT.additionalProperties, false)
})
