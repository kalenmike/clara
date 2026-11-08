import assert from 'node:assert/strict'
import test from 'node:test'
import { planDeliveries, type DeliveryAlert, type DeliveryRun } from './delivery.ts'

const run = (overrides: Partial<DeliveryRun> = {}): DeliveryRun => ({
  id: 12,
  state: 'running',
  pipeline_ref: 'std:software/feature',
  parent_run_id: null,
  origin_session_id: 'ses_origin',
  origin_harness: 'opencode',
  origin_agent: 'clara',
  ...overrides,
})

const alert = (overrides: Partial<DeliveryAlert> = {}): DeliveryAlert => ({
  id: 7,
  run_id: 12,
  step_path: '1-create_spec',
  kind: 'failure',
  title: 'Step failed: create_spec',
  body: 'The spec step failed.',
  ...overrides,
})

const empty = () => ({ deliveredAlerts: new Set<number>(), deliveredRuns: new Set<number>() })

test('plans a new alert for a running run', () => {
  const messages = planDeliveries({
    runs: [run()],
    alerts: [alert()],
    ...empty(),
    interfaceAgent: 'clara',
  })
  assert.equal(messages.length, 1)
  assert.equal(messages[0].runID, 12)
  assert.equal(messages[0].sessionID, 'ses_origin')
  assert.deepEqual(messages[0].alertIDs, [7])
  assert.equal(messages[0].terminal, false)
  assert.match(messages[0].text, /run 12/)
  assert.match(messages[0].text, /Do not start a new run/)
})

test('does not repeat a delivered alert', () => {
  const messages = planDeliveries({
    runs: [run()],
    alerts: [alert()],
    deliveredAlerts: new Set([7]),
    deliveredRuns: new Set(),
    interfaceAgent: 'clara',
  })
  assert.deepEqual(messages, [])
})

test('plans one terminal message for a finished root run', () => {
  const messages = planDeliveries({
    runs: [run({ state: 'completed' })],
    alerts: [],
    ...empty(),
    interfaceAgent: 'clara',
  })
  assert.equal(messages.length, 1)
  assert.equal(messages[0].terminal, true)
  assert.match(messages[0].text, /completed/)
})

test('includes new alerts in the terminal message and marks all of them', () => {
  const messages = planDeliveries({
    runs: [run({ state: 'failed', error: 'tests failed' })],
    alerts: [alert({ id: 9 }), alert({ id: 10, kind: 'budget' })],
    ...empty(),
    interfaceAgent: 'clara',
  })
  assert.equal(messages.length, 1)
  assert.deepEqual(messages[0].alertIDs, [9, 10])
  assert.equal(messages[0].terminal, true)
  assert.match(messages[0].text, /failed: tests failed/)
  assert.match(messages[0].text, /budget/)
})

test('does not repeat a finished run', () => {
  const messages = planDeliveries({
    runs: [run({ state: 'completed' })],
    alerts: [],
    deliveredAlerts: new Set(),
    deliveredRuns: new Set([12]),
    interfaceAgent: 'clara',
  })
  assert.deepEqual(messages, [])
})

test('skips terminal child runs', () => {
  const messages = planDeliveries({
    runs: [run({ state: 'completed', parent_run_id: 3 })],
    alerts: [],
    ...empty(),
    interfaceAgent: 'clara',
  })
  assert.deepEqual(messages, [])
})

test('skips a run with no origin session', () => {
  const messages = planDeliveries({
    runs: [run({ origin_session_id: null, state: 'completed' })],
    alerts: [alert()],
    ...empty(),
    interfaceAgent: 'clara',
  })
  assert.deepEqual(messages, [])
})

test('skips an origin owned by another agent', () => {
  const messages = planDeliveries({
    runs: [run({ origin_agent: 'build' })],
    alerts: [alert()],
    ...empty(),
    interfaceAgent: 'clara',
  })
  assert.deepEqual(messages, [])
})

test('allows a run whose origin agent was not recorded', () => {
  const messages = planDeliveries({
    runs: [run({ origin_agent: null })],
    alerts: [alert()],
    ...empty(),
    interfaceAgent: 'clara',
  })
  assert.equal(messages.length, 1)
})

test('limits the alert detail in a message', () => {
  const messages = planDeliveries({
    runs: [run()],
    alerts: [
      alert({ id: 1 }),
      alert({ id: 2 }),
      alert({ id: 3 }),
      alert({ id: 4 }),
      alert({ id: 5 }),
    ],
    ...empty(),
    interfaceAgent: 'clara',
  })
  assert.equal(messages.length, 1)
  assert.equal(messages[0].alertIDs.length, 5)
  assert.match(messages[0].text, /2 more open alert/)
})
