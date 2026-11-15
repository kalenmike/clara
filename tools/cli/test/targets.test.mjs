import assert from 'node:assert/strict'
import test from 'node:test'
import {
  LIFECYCLE_TARGETS,
  PAIR_TARGETS,
  serviceKey,
  takeTarget,
} from '../src/lib/targets.mjs'

test('accepts every lifecycle target', () => {
  for (const target of LIFECYCLE_TARGETS) {
    assert.equal(takeTarget([target, '--json']).target, target)
  }
})

test('defaults to the core stack when no target is given', () => {
  assert.deepEqual(takeTarget(['--json']), { target: 'default', args: ['--json'] })
  assert.deepEqual(takeTarget([]), { target: 'default', args: [] })
})

test('leaves unknown words in place for the caller to reject', () => {
  assert.deepEqual(takeTarget(['wat', '--json'], ['default', 'hub']), {
    target: 'default',
    args: ['wat', '--json'],
  })
})

test('maps the public hub target to the internal server service', () => {
  assert.equal(serviceKey('hub'), 'server')
  assert.equal(serviceKey('web'), 'web')
  assert.equal(serviceKey('engine'), 'engine')
})

test('rejects the removed orchestrator and adapter targets', () => {
  assert.deepEqual(takeTarget(['orchestrator', '--json']), {
    target: 'default',
    args: ['orchestrator', '--json'],
  })
  assert.deepEqual(takeTarget(['adapter', '--json']), {
    target: 'default',
    args: ['adapter', '--json'],
  })
})

test('limits pairing targets', () => {
  assert.deepEqual(PAIR_TARGETS, ['default', 'hub'])
})
