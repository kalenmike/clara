import assert from 'node:assert/strict'
import test from 'node:test'
import { CONTROL_TOOL_OPTIONS } from './index.ts'

test('registers Clara control tools as native tools', () => {
  assert.equal(CONTROL_TOOL_OPTIONS.namespace, 'clara')
  assert.equal(CONTROL_TOOL_OPTIONS.codemode, false)
})
