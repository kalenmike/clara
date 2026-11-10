import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  VOLUMES,
  defaultEnv,
  ensureOrchestratorEnv,
  parseEnvFile,
  parseSelection,
  readDockerToken,
  selectedNames,
} from '../lib/stack-control.mjs'

test('selects all services by default', () => {
  assert.deepEqual(parseSelection([]), {
    server: true,
    web: true,
    orchestrator: true,
    build: false,
    json: false,
    mode: 'docker',
  })
})

test('handles multiple exclusions, build, and json', () => {
  assert.deepEqual(
    parseSelection(['--no-web', '--no-orchestrator', '--build', '--json'], { json: true }),
    {
      server: true,
      web: false,
      orchestrator: false,
      build: true,
      json: true,
      mode: 'docker',
    }
  )
})

test('parses local and explicit docker modes', () => {
  assert.equal(parseSelection(['--local']).mode, 'local')
  assert.equal(parseSelection(['--docker']).mode, 'docker')
  assert.equal(parseSelection(['--local', '--build']).build, true)
  assert.throws(() => parseSelection(['--local', '--docker']), /cannot be combined/)
})

test('can exclude every service', () => {
  const selection = parseSelection(['--no-server', '--no-web', '--no-orchestrator'])
  assert.deepEqual(selectedNames(selection), [])
})

test('rejects unknown options and flags that are not allowed', () => {
  assert.throws(() => parseSelection(['--no-wb']), /unknown option: --no-wb/)
  assert.throws(() => parseSelection(['--build'], { build: false }), /unknown option: --build/)
  assert.throws(() => parseSelection(['--json']), /unknown option: --json/)
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
      'CLARA_ORCHESTRATOR_DATA_DIR=/tmp/data',
      '',
    ].join('\n')
  )
  assert.deepEqual(parseEnvFile(path), {
    CLARA_ORCHESTRATION_TOKEN: 'abc123',
    CLARA_WORKSPACE: '/tmp/workspace',
    CLARA_ORCHESTRATOR_DATA_DIR: '/tmp/data',
  })
})

test('builds first-run defaults with a random token and workspace', () => {
  const values = defaultEnv('/tmp/clara-repo')
  assert.equal(values.CLARA_WORKSPACE, '/tmp/clara-repo')
  assert.match(values.CLARA_ORCHESTRATION_TOKEN, /^[a-f0-9]{64}$/)
  assert.equal('CLARA_DATA_DIR' in values, false)
})

test('keeps the Docker control token out of local data', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'clara-stack-'))
  const repo = join(dir, 'repo')
  const workspace = join(dir, 'workspace')
  const state = join(dir, 'docker-state')
  mkdirSync(join(repo, 'docker'), { recursive: true })
  mkdirSync(workspace, { recursive: true })
  const token = 'a'.repeat(64)
  writeFileSync(
    join(repo, 'docker', '.env'),
    [`CLARA_ORCHESTRATION_TOKEN=${token}`, `CLARA_WORKSPACE=${workspace}`, ''].join('\n')
  )

  const previous = process.env.CLARA_DOCKER_STATE_DIR
  process.env.CLARA_DOCKER_STATE_DIR = state
  t.after(() => {
    if (previous === undefined) delete process.env.CLARA_DOCKER_STATE_DIR
    else process.env.CLARA_DOCKER_STATE_DIR = previous
    rmSync(dir, { recursive: true, force: true })
  })

  const result = ensureOrchestratorEnv(repo)
  assert.equal(result.workspace, workspace)
  assert.equal(result.stateDir, state)
  assert.equal(result.tokenPath, join(state, 'orchestrator.token'))
  assert.equal(readFileSync(result.tokenPath, 'utf8').trim(), token)
  assert.equal(readDockerToken(repo), token)
  assert.equal(existsSync(join(workspace, 'orchestrator.token')), false)
})

test('lists the Docker state volumes', () => {
  assert.deepEqual(VOLUMES, ['clara-server-config', 'clara-server-data', 'clara-orchestrator-data'])
})
