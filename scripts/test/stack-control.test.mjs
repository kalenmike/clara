import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { defaultEnv, parseEnvFile, parseSelection, selectedNames } from '../lib/stack-control.mjs'

test('selects all services by default', () => {
  assert.deepEqual(parseSelection([]), {
    server: true,
    web: true,
    orchestrator: true,
    build: false,
  })
})

test('handles multiple exclusions and build', () => {
  assert.deepEqual(parseSelection(['--no-web', '--no-orchestrator', '--build']), {
    server: true,
    web: false,
    orchestrator: false,
    build: true,
  })
})

test('can exclude every service', () => {
  const selection = parseSelection(['--no-server', '--no-web', '--no-orchestrator'])
  assert.deepEqual(selectedNames(selection), [])
})

test('rejects unknown options and build where it is not allowed', () => {
  assert.throws(() => parseSelection(['--no-wb']), /unknown option: --no-wb/)
  assert.throws(() => parseSelection(['--build'], { build: false }), /unknown option: --build/)
})

test('keeps start order and reverses it for stop', () => {
  const selection = parseSelection([])
  assert.deepEqual(selectedNames(selection), ['orchestrator', 'server', 'web'])
  assert.deepEqual(selectedNames(selection, ['web', 'server', 'orchestrator']), [
    'web',
    'server',
    'orchestrator',
  ])
})

test('parses simple env files, comments, and quotes', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'clara-stack-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const path = join(dir, '.env')
  writeFileSync(
    path,
    [
      '# comment',
      'CLARA_ORCHESTRATION_TOKEN="abc123"',
      "CLARA_WORKSPACE='/tmp/workspace'",
      'CLARA_DATA_DIR=/tmp/data',
      '',
    ].join('\n')
  )
  assert.deepEqual(parseEnvFile(path), {
    CLARA_ORCHESTRATION_TOKEN: 'abc123',
    CLARA_WORKSPACE: '/tmp/workspace',
    CLARA_DATA_DIR: '/tmp/data',
  })
})

test('builds absolute first-run defaults with a random token', () => {
  const values = defaultEnv('/tmp/clara-repo')
  assert.equal(values.CLARA_WORKSPACE, '/tmp/clara-repo')
  assert.match(values.CLARA_ORCHESTRATION_TOKEN, /^[a-f0-9]{64}$/)
  assert.match(values.CLARA_DATA_DIR, /clara[\\/]orchestrator$/)
})
