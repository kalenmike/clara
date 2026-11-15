import assert from 'node:assert/strict'
import test from 'node:test'
import {
  BACKUP_TARGETS,
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
  assert.deepEqual(takeTarget(['--local']), { target: 'default', args: ['--local'] })
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

test('rejects the removed orchestrator target', () => {
  assert.deepEqual(takeTarget(['orchestrator', '--json']), {
    target: 'default',
    args: ['orchestrator', '--json'],
  })
})

test('limits backup and pairing targets', () => {
  assert.deepEqual(BACKUP_TARGETS, ['default', 'hub', 'engine'])
  assert.deepEqual(PAIR_TARGETS, ['default', 'hub', 'adapter'])
  assert.equal(takeTarget(['hub', 'archive.tar.gz'], BACKUP_TARGETS).target, 'hub')
  assert.equal(takeTarget(['archive.tar.gz'], BACKUP_TARGETS).target, 'default')
})
