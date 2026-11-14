import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  VOLUMES,
  composeEnvValues,
  defaultEnv,
  ensureOrchestratorEnv,
  envPath,
  hubEnvErrors,
  hubEnvWarnings,
  orchestratorEnvErrors,
  parseEnvFile,
  readDockerToken,
} from '../src/lib/stack-control.mjs'

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
  mkdirSync(join(repo, 'infra', 'docker'), { recursive: true })
  mkdirSync(workspace, { recursive: true })
  const token = 'a'.repeat(64)
  writeFileSync(
    join(repo, 'infra', 'docker', '.env'),
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

test('compose env reads infra/docker/.env and lets the shell win', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'clara-stack-'))
  mkdirSync(join(dir, 'infra', 'docker'), { recursive: true })
  writeFileSync(
    join(dir, 'infra', 'docker', '.env'),
    ['CLARA_RELAY_URL=wss://relay.example', 'CLARA_AGENT_TOKEN=file-token', ''].join('\n')
  )
  t.after(() => rmSync(dir, { recursive: true, force: true }))

  const values = composeEnvValues(dir, { CLARA_AGENT_TOKEN: 'shell-token' })
  assert.equal(values.CLARA_RELAY_URL, 'wss://relay.example')
  assert.equal(values.CLARA_AGENT_TOKEN, 'shell-token')
})

test('falls back to the legacy docker/.env after the move', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'clara-stack-legacy-'))
  mkdirSync(join(dir, 'docker'), { recursive: true })
  writeFileSync(join(dir, 'docker', '.env'), 'CLARA_RELAY_URL=wss://legacy.example\n')
  t.after(() => rmSync(dir, { recursive: true, force: true }))

  assert.equal(envPath(dir), join(dir, 'docker', '.env'))
  const values = composeEnvValues(dir, {})
  assert.equal(values.CLARA_RELAY_URL, 'wss://legacy.example')
})

test('hub env warns when a relay URL has no environment tokens', () => {
  assert.deepEqual(hubEnvErrors({}), [])
  assert.deepEqual(hubEnvErrors({ CLARA_RELAY_URL: 'wss://relay.example' }), [])

  const warnings = hubEnvWarnings({ CLARA_RELAY_URL: 'wss://relay.example' })
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /CLARA_AGENT_TOKEN/)
  assert.deepEqual(
    hubEnvWarnings({
      CLARA_RELAY_URL: 'wss://relay.example',
      CLARA_AGENT_TOKEN: 'agent',
    }),
    []
  )
})

test('hub env rejects relative bind directories', () => {
  const errors = hubEnvErrors({ CLARA_SERVER_DATA_DIR: 'data' })
  assert.equal(errors.length, 1)
  assert.match(errors[0], /CLARA_SERVER_DATA_DIR must be an absolute path/)
})

test('hub env warns about a half-configured VAPID key pair', () => {
  assert.deepEqual(hubEnvWarnings({}), [])
  const warnings = hubEnvWarnings({ CLARA_VAPID_PUBLIC_KEY: 'public' })
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /CLARA_VAPID_PUBLIC_KEY and CLARA_VAPID_PRIVATE_KEY/)
})

test('orchestrator env reports missing, example, and invalid workspace values', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'clara-stack-'))
  const workspace = join(dir, 'workspace')
  mkdirSync(workspace)
  t.after(() => rmSync(dir, { recursive: true, force: true }))

  assert.match(
    orchestratorEnvErrors({}, { envFile: join(dir, 'infra', 'docker', '.env') })[0],
    /Missing CLARA_ORCHESTRATION_TOKEN, CLARA_WORKSPACE/
  )
  mkdirSync(join(dir, 'infra', 'docker'), { recursive: true })
  const envFile = join(dir, 'infra', 'docker', '.env')
  writeFileSync(envFile, '')
  assert.match(
    orchestratorEnvErrors({}, { envFile })[0],
    /is missing CLARA_ORCHESTRATION_TOKEN, CLARA_WORKSPACE/
  )
  assert.match(
    orchestratorEnvErrors({
      CLARA_ORCHESTRATION_TOKEN: 'replace-with-a-long-random-token',
      CLARA_WORKSPACE: workspace,
    }).join(' '),
    /example token/
  )
  assert.match(
    orchestratorEnvErrors({
      CLARA_ORCHESTRATION_TOKEN: 'token',
      CLARA_WORKSPACE: 'relative/path',
    }).join(' '),
    /CLARA_WORKSPACE must be an absolute path/
  )
  assert.match(
    orchestratorEnvErrors({
      CLARA_ORCHESTRATION_TOKEN: 'token',
      CLARA_WORKSPACE: join(dir, 'missing'),
    }).join(' '),
    /CLARA_WORKSPACE does not exist/
  )
  assert.match(
    orchestratorEnvErrors({
      CLARA_ORCHESTRATION_TOKEN: 'token',
      CLARA_WORKSPACE: workspace,
      CLARA_ORCHESTRATOR_DATA_DIR: 'data',
    }).join(' '),
    /CLARA_ORCHESTRATOR_DATA_DIR must be an absolute path/
  )
  assert.deepEqual(
    orchestratorEnvErrors({
      CLARA_ORCHESTRATION_TOKEN: 'token',
      CLARA_WORKSPACE: workspace,
    }),
    []
  )
})
