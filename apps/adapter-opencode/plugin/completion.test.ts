import assert from 'node:assert/strict'
import test from 'node:test'
import { planMissingControl, settleBinding } from './index.ts'
import type { SettleBinding } from './index.ts'

test('asks once for a control call before inferring a result', () => {
  assert.equal(planMissingControl({ kind: 'agent', corrected: false }), 'correct')
  assert.equal(planMissingControl({ kind: 'agent', corrected: true }), 'fail')
  assert.equal(
    planMissingControl({ kind: 'agent', corrected: true, lastText: 'auth refactored' }),
    'complete'
  )
  assert.equal(planMissingControl({ kind: 'agent', corrected: true, lastText: '   ' }), 'fail')
})

test('never infers a router decision from prose', () => {
  assert.equal(planMissingControl({ kind: 'router', corrected: false }), 'fail')
  assert.equal(planMissingControl({ kind: 'router', corrected: true, lastText: 'feature' }), 'fail')
})

test('a settled binding is never asked for another control call', () => {
  assert.equal(planMissingControl({ kind: 'agent', closed: true }), 'ignore')
  assert.equal(planMissingControl({ kind: 'router', closed: true }), 'ignore')
  assert.equal(
    planMissingControl({ kind: 'agent', closed: true, corrected: true, lastText: 'done' }),
    'ignore'
  )
})

test('a managed worker keeps its closed binding until it goes idle', () => {
  const timer = setInterval(() => {}, 60_000)
  timer.unref?.()
  const active = new Map<string, SettleBinding>([
    ['ses_worker', { session: 'ses_worker', managed: true, closed: false, beatTimer: timer }],
  ])
  const lastTurn = new Map([['ses_worker', 1]])

  const work = settleBinding(active, lastTurn, 'ses_worker')

  assert.equal(work?.closed, true)
  assert.equal(work?.beatTimer, undefined)
  assert.equal(active.has('ses_worker'), true)
  assert.equal(lastTurn.has('ses_worker'), true)
})

test('a fallback binding detaches without touching the human session', () => {
  const active = new Map<string, SettleBinding>([
    ['ses_human', { session: 'ses_human', managed: false, closed: false }],
  ])
  const lastTurn = new Map([['ses_human', 1]])

  settleBinding(active, lastTurn, 'ses_human')

  assert.equal(active.has('ses_human'), false)
  assert.equal(lastTurn.has('ses_human'), false)
})

test('detaching a settled managed binding releases it', () => {
  const active = new Map<string, SettleBinding>([
    ['ses_worker', { session: 'ses_worker', managed: true, closed: true }],
  ])
  const lastTurn = new Map([['ses_worker', 1]])

  settleBinding(active, lastTurn, 'ses_worker', true)

  assert.equal(active.has('ses_worker'), false)
  assert.equal(lastTurn.has('ses_worker'), false)
})
