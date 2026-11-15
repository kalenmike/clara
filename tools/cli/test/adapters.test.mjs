import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  HARNESSES,
  adapterPaths,
  adapterRecord,
  mcpState,
  selectHarnesses,
} from '../src/lib/adapters.mjs'

function sandbox(t) {
  const dir = mkdtempSync(join(tmpdir(), 'clara-adapters-'))
  const env = {
    ...process.env,
    XDG_CONFIG_HOME: join(dir, 'config'),
    XDG_DATA_HOME: join(dir, 'data'),
  }
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return { dir, env }
}

function writeJson(path, value) {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, JSON.stringify(value))
}

test('reports a missing adapter without a config', (t) => {
  const { env } = sandbox(t)
  const record = adapterRecord('opencode', env)
  assert.equal(record.installed, false)
  assert.equal(record.running, false)
  assert.equal(record.mcp.configured, false)
})

test('reads a running adapter, its link state, and MCP config', (t) => {
  const { env } = sandbox(t)
  const paths = adapterPaths('opencode', env)
  writeJson(paths.configPath, { wsUrl: 'ws://127.0.0.1:8788/ws' })
  writeJson(paths.identityPath, { harnessId: 'h', adapterId: 'a', key: 'k' })
  writeJson(paths.statePath, {
    hub: {
      url: 'ws://127.0.0.1:8788/ws',
      status: 'authenticated',
      connected: true,
      authenticated: true,
    },
    harness: { reachable: true, version: '2.1.1', code: 'ok' },
  })
  writeFileSync(paths.pidPath, `${process.pid}\n`)
  writeJson(join(env.XDG_CONFIG_HOME, 'opencode', 'opencode.json'), {
    mcp: { clara: {}, 'clara-api': {} },
  })

  const record = adapterRecord('opencode', env)
  assert.equal(record.installed, true)
  assert.equal(record.running, true)
  assert.equal(record.hub.authenticated, true)
  assert.equal(record.harnessHealth.reachable, true)
  assert.equal(record.mcp.configured, true)
  assert.equal(record.mcp.api, true)
  assert.equal(record.ok, true)
})

test('selects installed adapters for lifecycle and all harnesses for status', (t) => {
  const { env } = sandbox(t)
  const paths = adapterPaths('claude', env)
  writeJson(paths.configPath, { wsUrl: 'ws://127.0.0.1:8788/ws' })

  assert.deepEqual(selectHarnesses({ env, installedOnly: true }), ['claude'])
  assert.deepEqual(selectHarnesses({ env, installedOnly: false }), [...HARNESSES])
  assert.deepEqual(selectHarnesses({ env, requested: ['claude'] }), ['claude'])
  assert.deepEqual(selectHarnesses({ env, requested: ['opencode'] }), [])
  assert.deepEqual(selectHarnesses({ env, requested: ['opencode'], installedOnly: false }), [
    'opencode',
  ])
  assert.throws(() => selectHarnesses({ env, requested: ['nope'] }), /unknown harness/)
})

test('reads the MCP bridge entries from the OpenCode config', (t) => {
  const { env } = sandbox(t)
  assert.deepEqual(mcpState(env), {
    path: join(env.XDG_CONFIG_HOME, 'opencode', 'opencode.json'),
    configured: false,
    api: false,
  })
})
