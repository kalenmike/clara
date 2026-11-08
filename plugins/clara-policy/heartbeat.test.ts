import assert from 'node:assert/strict'
import test, { mock } from 'node:test'
import { startStepHeartbeat } from './index.ts'

const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

test('renews a step on an interval', async () => {
  mock.timers.enable({ apis: ['setInterval'] })
  try {
    let beats = 0
    const timer = startStepHeartbeat(
      async () => {
        beats += 1
      },
      { intervalMs: 1_000 }
    )
    mock.timers.tick(3_000)
    await flush()
    assert.equal(beats, 3)
    clearInterval(timer)
  } finally {
    mock.timers.reset()
  }
})

test('stops beating when the lease is lost', async () => {
  mock.timers.enable({ apis: ['setInterval'] })
  try {
    let beats = 0
    let lost: Error | undefined
    startStepHeartbeat(
      async () => {
        beats += 1
        throw Object.assign(new Error('lease gone'), { code: 'lease_invalid' })
      },
      { intervalMs: 1_000, onLost: (error) => (lost = error) }
    )
    mock.timers.tick(1_000)
    await flush()
    assert.equal(beats, 1)
    assert.equal(lost?.message, 'lease gone')
    mock.timers.tick(5_000)
    await flush()
    assert.equal(beats, 1)
  } finally {
    mock.timers.reset()
  }
})

test('keeps beating through a transient transport error', async () => {
  mock.timers.enable({ apis: ['setInterval'] })
  try {
    let beats = 0
    let lost: Error | undefined
    startStepHeartbeat(
      async () => {
        beats += 1
        throw Object.assign(new Error('offline'), { code: 'ECONNREFUSED' })
      },
      { intervalMs: 1_000, onLost: (error) => (lost = error) }
    )
    mock.timers.tick(3_000)
    await flush()
    assert.equal(beats, 3)
    assert.equal(lost, undefined)
  } finally {
    mock.timers.reset()
  }
})
