import assert from 'node:assert/strict'
import test from 'node:test'
import { createDeliveryCycle } from '../src/delivery-cycle.ts'
import type { DeliveryAlert, DeliveryRun, DeliveryState } from '../src/delivery.ts'

const run = (overrides: Partial<DeliveryRun> = {}): DeliveryRun => ({
  id: 21,
  state: 'completed',
  pipeline_ref: 'std:software/bug',
  parent_run_id: null,
  origin_session_id: 'ses_origin',
  origin_harness: 'opencode',
  origin_agent: 'clara',
  ...overrides,
})

const alert = (overrides: Partial<DeliveryAlert> = {}): DeliveryAlert => ({
  id: 7,
  run_id: 21,
  step_path: '1-identify_bug',
  kind: 'failure',
  title: 'Step failed: identify_bug',
  body: 'The step failed.',
  ...overrides,
})

const emptyState = (): DeliveryState => ({ alerts: new Set(), runs: new Set() })

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => {}
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

test('delivers one terminal message when two cycles overlap', async () => {
  const state = emptyState()
  const started = deferred()
  const release = deferred()
  let delivered = 0
  const cycle = createDeliveryCycle({
    load: async () => ({ runs: [run()], alerts: [] }),
    usableOrigin: async () => true,
    deliver: async () => {
      delivered += 1
      started.resolve()
      await release.promise
    },
    state,
    persist: () => {},
    interfaceAgent: 'clara',
  })

  const first = cycle()
  await started.promise
  await cycle()
  assert.equal(delivered, 1)

  release.resolve()
  await first
  assert.deepEqual([...state.runs], [21])
})

test('does not deliver the same completed run on a later cycle', async () => {
  const state = emptyState()
  const delivered: string[] = []
  const cycle = createDeliveryCycle({
    load: async () => ({ runs: [run()], alerts: [] }),
    usableOrigin: async () => true,
    deliver: async (message) => {
      delivered.push(message.text)
    },
    state,
    persist: () => {},
  })

  await cycle()
  await cycle()
  assert.equal(delivered.length, 1)
})

test('reserves the run before the prompt resolves', async () => {
  const state = emptyState()
  let reservedDuringPrompt = false
  const cycle = createDeliveryCycle({
    load: async () => ({ runs: [run()], alerts: [] }),
    usableOrigin: async () => true,
    deliver: async () => {
      reservedDuringPrompt = state.runs.has(21)
    },
    state,
    persist: () => {},
  })

  await cycle()
  assert.equal(reservedDuringPrompt, true)
})

test('persists the reservation before the prompt', async () => {
  const order: string[] = []
  const cycle = createDeliveryCycle({
    load: async () => ({ runs: [run()], alerts: [] }),
    usableOrigin: async () => true,
    deliver: async () => {
      order.push('deliver')
    },
    state: emptyState(),
    persist: () => {
      order.push('persist')
    },
  })

  await cycle()
  assert.deepEqual(order, ['persist', 'deliver'])
})

test('rolls back a failed delivery so the next cycle retries it', async () => {
  const state = emptyState()
  let attempts = 0
  const cycle = createDeliveryCycle({
    load: async () => ({ runs: [run()], alerts: [alert()] }),
    usableOrigin: async () => true,
    deliver: async () => {
      attempts += 1
      if (attempts === 1) throw new Error('provider unavailable')
    },
    state,
    persist: () => {},
    onError: () => {},
  })

  await cycle()
  assert.equal(attempts, 1)
  assert.deepEqual([...state.runs], [])
  assert.deepEqual([...state.alerts], [])

  await cycle()
  assert.equal(attempts, 2)
  assert.deepEqual([...state.runs], [21])
  assert.deepEqual([...state.alerts], [7])
})

test('a failed poll does not wedge later cycles', async () => {
  let polls = 0
  const delivered: number[] = []
  const cycle = createDeliveryCycle({
    load: async () => {
      polls += 1
      if (polls === 1) throw new Error('service restarting')
      return { runs: [run()], alerts: [] }
    },
    usableOrigin: async () => true,
    deliver: async (message) => {
      delivered.push(message.runID)
    },
    state: emptyState(),
    persist: () => {},
  })

  await cycle()
  await cycle()
  assert.deepEqual(delivered, [21])
})

test('delivers a terminal run once across independent adapter instances', async () => {
  let claimed = false
  let delivered = 0
  const cycle = (state: DeliveryState) =>
    createDeliveryCycle({
      load: async () => ({ runs: [run()], alerts: [] }),
      usableOrigin: async () => true,
      claim: async (message) => {
        if (claimed) return null
        claimed = true
        return message
      },
      deliver: async () => {
        delivered += 1
      },
      state,
      persist: () => {},
    })

  const one = emptyState()
  const two = emptyState()
  await Promise.all([cycle(one)(), cycle(two)()])

  assert.equal(delivered, 1)
  assert.deepEqual([...one.runs], [21])
  assert.deepEqual([...two.runs], [21])
})

test('stops re-claiming a message another instance owns', async () => {
  let claims = 0
  let delivered = 0
  const state = emptyState()
  const cycle = createDeliveryCycle({
    load: async () => ({ runs: [run()], alerts: [] }),
    usableOrigin: async () => true,
    claim: async () => {
      claims += 1
      return null
    },
    deliver: async () => {
      delivered += 1
    },
    state,
    persist: () => {},
  })

  await cycle()
  assert.equal(claims, 1)
  assert.equal(delivered, 0)
  assert.deepEqual([...state.runs], [21])

  await cycle()
  assert.equal(claims, 1)
  assert.equal(delivered, 0)
})

test('releases the claim when the prompt rejects so another cycle retries', async () => {
  const state = emptyState()
  let attempts = 0
  let released = 0
  const cycle = createDeliveryCycle({
    load: async () => ({ runs: [run()], alerts: [] }),
    usableOrigin: async () => true,
    claim: async (message) => message,
    release: async () => {
      released += 1
    },
    deliver: async () => {
      attempts += 1
      if (attempts === 1) throw new Error('provider unavailable')
    },
    state,
    persist: () => {},
    onError: () => {},
  })

  await cycle()
  assert.equal(attempts, 1)
  assert.equal(released, 1)
  assert.deepEqual([...state.runs], [])

  await cycle()
  assert.equal(attempts, 2)
  assert.equal(released, 1)
  assert.deepEqual([...state.runs], [21])
})
