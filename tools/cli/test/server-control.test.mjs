import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { serverLocalState } from '../src/lib/server-control.mjs'

test('serverLocalState finds a local database', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'clara-server-state-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const env = {
    XDG_CONFIG_HOME: join(root, 'config'),
    XDG_DATA_HOME: join(root, 'data'),
    CLARA_RUNTIME_FILE: join(root, 'runtime.json'),
  }

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
    CLARA_RUNTIME_FILE: join(root, 'runtime.json'),
  })

  assert.equal(state.configDir, join(root, 'config'))
  assert.equal(state.dataDir, join(root, 'data'))
  assert.equal(state.dbPath, join(root, 'data', 'clara.db'))
})
