import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { resolveServerTarget, serverLocalState } from '../lib/server-control.mjs'

test('explicit flags win over detection', () => {
  assert.deepEqual(
    resolveServerTarget({ docker: true, health: 'local', localState: { present: true } }),
    { target: 'container', reason: '--docker' }
  )
  assert.deepEqual(
    resolveServerTarget({ local: true, health: 'container', dockerState: { running: true } }),
    { target: 'local', reason: '--local' }
  )
})

test('passing both explicit flags is ambiguous', () => {
  const result = resolveServerTarget({ docker: true, local: true })
  assert.equal(result.target, 'ambiguous')
  assert.match(result.reason, /--docker and --local/)
})

test('the panel health mode selects the target', () => {
  assert.equal(resolveServerTarget({ health: 'container' }).target, 'container')
  assert.equal(resolveServerTarget({ health: 'local' }).target, 'local')
})

test('a running container wins over leftover local state', () => {
  const result = resolveServerTarget({
    dockerState: { running: true, present: true },
    localState: { present: true },
  })
  assert.equal(result.target, 'container')
  assert.match(result.reason, /container is running/)
})

test('stopped Docker state alone selects the container', () => {
  const result = resolveServerTarget({
    dockerState: { running: false, present: true },
    localState: { present: false },
  })
  assert.equal(result.target, 'container')
})

test('a local install alone selects the host', () => {
  const result = resolveServerTarget({
    dockerState: { running: false, present: false },
    localState: { present: true },
  })
  assert.equal(result.target, 'local')
})

test('both stopped deployments are ambiguous', () => {
  const result = resolveServerTarget({
    dockerState: { running: false, present: true },
    localState: { present: true },
  })
  assert.equal(result.target, 'ambiguous')
  assert.match(result.reason, /both a local install and Docker state/)
})

test('no state defaults to the host', () => {
  assert.equal(resolveServerTarget({}).target, 'local')
  assert.equal(
    resolveServerTarget({
      dockerState: { running: false, present: false },
      localState: { present: false },
    }).target,
    'local'
  )
})

test('serverLocalState finds a local database', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'clara-server-state-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const env = { XDG_CONFIG_HOME: join(root, 'config'), XDG_DATA_HOME: join(root, 'data') }

  assert.equal(serverLocalState(env).present, false)

  mkdirSync(join(root, 'data', 'clara'), { recursive: true })
  writeFileSync(join(root, 'data', 'clara', 'clara.db'), '')
  const state = serverLocalState(env)
  assert.equal(state.present, true)
  assert.equal(state.dbPath, join(root, 'data', 'clara', 'clara.db'))
})

test('CLARA_* directories override the XDG paths', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'clara-server-state-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const state = serverLocalState({
    CLARA_CONFIG_DIR: join(root, 'config'),
    CLARA_DATA_DIR: join(root, 'data'),
  })

  assert.equal(state.configDir, join(root, 'config'))
  assert.equal(state.dataDir, join(root, 'data'))
  assert.equal(state.dbPath, join(root, 'data', 'clara.db'))
})
