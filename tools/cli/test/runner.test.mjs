import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  readRunnerManifest,
  runnerConfigPath,
  runnerInstallArgs,
  runnerManifestPath,
  runnerStatus,
} from '../src/lib/runner.mjs'

function sandbox(t) {
  const dir = mkdtempSync(join(tmpdir(), 'clara-runner-'))
  const env = { ...process.env, XDG_CONFIG_HOME: join(dir, 'config') }
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return { env }
}

function writeManifest(env, runner) {
  const path = runnerManifestPath(env)
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, JSON.stringify({ version: 1, updatedAt: Date.now(), runner }))
}

test('reports a missing runner', (t) => {
  const { env } = sandbox(t)
  assert.equal(readRunnerManifest(env), undefined)
  const status = runnerStatus(env)
  assert.equal(status.installed, false)
  assert.equal(status.config, runnerConfigPath(env))
})

test('reads an installed runner manifest', (t) => {
  const { env } = sandbox(t)
  writeManifest(env, {
    url: 'http://127.0.0.1:8789',
    workspace: '/workspace',
    concurrency: 2,
    labels: ['build'],
    service: 'none',
    explicit: true,
    installedAt: 1,
  })
  const status = runnerStatus(env)
  assert.equal(status.installed, true)
  assert.equal(status.service, 'none')
  assert.equal(status.active, 'foreground')
  assert.equal(status.manifest.workspace, '/workspace')
})

test('builds installer arguments from lifecycle options', () => {
  assert.deepEqual(runnerInstallArgs({ workspace: '/w', concurrency: 3, labels: ['a', 'b'] }), [
    'install',
    '--workspace',
    '/w',
    '--concurrency',
    '3',
    '--label',
    'a',
    '--label',
    'b',
  ])
})
