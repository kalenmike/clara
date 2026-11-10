import assert from 'node:assert/strict'
import test from 'node:test'
import {
  displayState,
  renderJSON,
  renderStatus,
  resolveState,
  statusExitCode,
} from '../lib/status.mjs'

const runningContainer = { available: true, state: 'running' }
const stoppedContainer = { available: true, state: 'exited' }
const missingContainer = { available: true, state: 'missing' }
const noDocker = { available: false, state: 'unknown' }

function record(overrides = {}) {
  return {
    service: 'server',
    container: 'clara-server',
    state: 'running',
    mode: 'container',
    healthy: true,
    url: 'http://127.0.0.1:8788',
    error: null,
    details: {
      panel: 'http://127.0.0.1:8790 (running)',
      admin: 'configured',
    },
    ...overrides,
  }
}

test('maps health and container state to one status', () => {
  assert.deepEqual(resolveState({ health: 'ok', container: runningContainer }), {
    state: 'running',
    mode: 'container',
  })
  assert.deepEqual(resolveState({ health: 'ok', container: missingContainer, mode: 'local' }), {
    state: 'running',
    mode: 'local',
  })
  assert.deepEqual(resolveState({ health: 'ok', container: missingContainer }), {
    state: 'running',
    mode: 'external',
  })
  assert.deepEqual(resolveState({ health: 'fail', container: runningContainer }), {
    state: 'unhealthy',
    mode: 'container',
  })
  assert.deepEqual(resolveState({ health: 'fail', container: stoppedContainer }), {
    state: 'stopped',
    mode: 'container',
  })
  assert.deepEqual(resolveState({ health: 'fail', container: missingContainer }), {
    state: 'stopped',
    mode: 'unknown',
  })
  assert.deepEqual(resolveState({ health: 'fail', container: noDocker }), {
    state: 'unknown',
    mode: 'unknown',
  })
  assert.deepEqual(resolveState({ health: 'foreign', container: runningContainer }), {
    state: 'unavailable',
    mode: 'unknown',
  })
})

test('renders one stable state label', () => {
  assert.equal(displayState(record()), 'running (container)')
  assert.equal(displayState(record({ state: 'stopped', mode: 'unknown' })), 'stopped')
})

test('uses one exit code for all records', () => {
  assert.equal(statusExitCode([record(), record({ service: 'web' })]), 0)
  assert.equal(
    statusExitCode([record(), record({ service: 'web', state: 'stopped', healthy: false })]),
    1
  )
})

test('renders the same table for a stack and for one service', () => {
  const lines = []
  renderStatus(
    [
      record(),
      record({
        service: 'web',
        container: 'clara-web',
        state: 'stopped',
        mode: 'unknown',
        healthy: false,
        url: 'http://127.0.0.1:8080',
        error: 'unreachable',
        details: { kind: 'static SPA' },
      }),
    ],
    { write: (line) => lines.push(line) }
  )
  assert.equal(lines[0], 'Clara stack')
  assert.match(lines.join('\n'), /SERVICE\s+CONTAINER\s+STATE\s+URL/)
  assert.match(
    lines.join('\n'),
    /server\s+clara-server\s+running \(container\)\s+http:\/\/127\.0\.0\.1:8788/
  )
  assert.match(lines.join('\n'), /web\s+clara-web\s+stopped/)
  assert.match(lines.join('\n'), /Details/)
  assert.match(lines.join('\n'), /Errors/)
  assert.match(lines.join('\n'), /web: unreachable/)

  const single = []
  renderStatus([record()], {
    title: 'Clara server',
    write: (line) => single.push(line),
  })
  assert.equal(single[0], 'Clara server')
  assert.match(single.join('\n'), /SERVICE\s+CONTAINER\s+STATE\s+URL/)
  assert.match(
    single.join('\n'),
    /server\s+clara-server\s+running \(container\)\s+http:\/\/127\.0\.0\.1:8788/
  )
  assert.match(single.join('\n'), /panel\s+http:\/\/127\.0\.0\.1:8790 \(running\)/)
  assert.doesNotMatch(single.join('\n'), /local\s+http:\/\//)
  assert.match(single.join('\n'), /admin\s+configured/)
})

test('emits one record for a service and an envelope for the stack', () => {
  const single = []
  renderJSON([record()], { write: (line) => single.push(line) })
  const parsed = JSON.parse(single.join('\n'))
  assert.equal(parsed.service, 'server')
  assert.equal(parsed.state, 'running')
  assert.equal(parsed.healthy, true)

  const stack = []
  renderJSON([record(), record({ service: 'web' })], {
    stack: true,
    write: (line) => stack.push(line),
  })
  const envelope = JSON.parse(stack.join('\n'))
  assert.equal(envelope.ok, true)
  assert.equal(envelope.services.length, 2)
  assert.equal(envelope.services[0].service, 'server')
})
