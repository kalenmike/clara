import assert from 'node:assert/strict'
import test from 'node:test'
import { planMissingControl } from './index.ts'

test('asks once for a control call before inferring a result', () => {
  assert.equal(planMissingControl({ kind: 'task', corrected: false }), 'correct')
  assert.equal(planMissingControl({ kind: 'task', corrected: true }), 'fail')
  assert.equal(
    planMissingControl({ kind: 'task', corrected: true, lastText: 'auth refactored' }),
    'complete'
  )
  assert.equal(planMissingControl({ kind: 'task', corrected: true, lastText: '   ' }), 'fail')
})

test('never infers a router decision from prose', () => {
  assert.equal(planMissingControl({ kind: 'router', corrected: false }), 'fail')
  assert.equal(planMissingControl({ kind: 'router', corrected: true, lastText: 'feature' }), 'fail')
})
