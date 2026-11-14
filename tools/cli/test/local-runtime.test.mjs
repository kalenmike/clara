import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  parseMode,
  pidPath,
  processAlive,
  readPid,
  recordPid,
  stateDir,
  stopDetached,
} from '../src/lib/local-runtime.mjs'
import { distFile } from '../src/lib/local-web.mjs'

function spawnFixture(args = []) {
  return spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)', ...args], {
    stdio: 'ignore',
  })
}

test('defaults to docker and parses explicit modes', () => {
  assert.equal(parseMode([]), 'docker')
  assert.equal(parseMode(['--docker']), 'docker')
  assert.equal(parseMode(['--local']), 'local')
  assert.throws(() => parseMode(['--local', '--docker']), /cannot be combined/)
})

test('uses CLARA_DATA_DIR for local pid and log paths', () => {
  const previous = process.env.CLARA_DATA_DIR
  process.env.CLARA_DATA_DIR = '/tmp/clara-local-test'
  try {
    assert.equal(stateDir(), '/tmp/clara-local-test')
    assert.equal(pidPath('server'), '/tmp/clara-local-test/server.pid')
  } finally {
    if (previous === undefined) delete process.env.CLARA_DATA_DIR
    else process.env.CLARA_DATA_DIR = previous
  }
})

test('reports a stale pid file without treating it as running', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'clara-local-'))
  const previous = process.env.CLARA_DATA_DIR
  process.env.CLARA_DATA_DIR = dir
  t.after(() => {
    if (previous === undefined) delete process.env.CLARA_DATA_DIR
    else process.env.CLARA_DATA_DIR = previous
    rmSync(dir, { recursive: true, force: true })
  })
  writeFileSync(pidPath('server'), '999999\n')
  assert.deepEqual(readPid('server'), { present: true, pid: 999999, alive: false })
})

test('stops a discovered process when the pid file is stale', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'clara-local-'))
  const previous = process.env.CLARA_DATA_DIR
  process.env.CLARA_DATA_DIR = dir
  writeFileSync(pidPath('web'), '999999\n')
  const child = spawnFixture(['local-web.mjs'])
  t.after(() => {
    if (child.exitCode === null) child.kill('SIGKILL')
    if (previous === undefined) delete process.env.CLARA_DATA_DIR
    else process.env.CLARA_DATA_DIR = previous
    rmSync(dir, { recursive: true, force: true })
  })
  const exited = once(child, 'exit')

  const result = await stopDetached({
    name: 'web',
    patterns: ['local-web.mjs'],
    discover: async () => child.pid,
    timeoutMs: 3_000,
    killTimeoutMs: 3_000,
  })

  assert.deepEqual(
    { status: result.status, pid: result.pid },
    { status: 'stopped', pid: child.pid }
  )
  await exited
  assert.equal(existsSync(pidPath('web')), false)
})

test('escalates to SIGKILL when the process ignores SIGTERM', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'clara-local-'))
  const previous = process.env.CLARA_DATA_DIR
  process.env.CLARA_DATA_DIR = dir
  const child = spawn(
    process.execPath,
    [
      '-e',
      "process.on('SIGTERM', () => {}); console.log('ready'); setInterval(() => {}, 1000)",
      'local-web.mjs',
    ],
    { stdio: ['ignore', 'pipe', 'ignore'] }
  )
  t.after(() => {
    if (child.exitCode === null) child.kill('SIGKILL')
    if (previous === undefined) delete process.env.CLARA_DATA_DIR
    else process.env.CLARA_DATA_DIR = previous
    rmSync(dir, { recursive: true, force: true })
  })
  if (!child.stdout) throw new Error('child did not expose stdout')
  await once(child.stdout, 'data')
  recordPid('web', child.pid)
  const exited = once(child, 'exit')

  const result = await stopDetached({
    name: 'web',
    patterns: ['local-web.mjs'],
    timeoutMs: 200,
    killTimeoutMs: 3_000,
  })

  assert.equal(result.status, 'stopped')
  assert.ok(result.escalated)
  await exited
})

test('leaves a live pid alone when its command is another service', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'clara-local-'))
  const previous = process.env.CLARA_DATA_DIR
  process.env.CLARA_DATA_DIR = dir
  const child = spawnFixture(['another-service.mjs'])
  t.after(() => {
    if (child.exitCode === null) child.kill('SIGKILL')
    if (previous === undefined) delete process.env.CLARA_DATA_DIR
    else process.env.CLARA_DATA_DIR = previous
    rmSync(dir, { recursive: true, force: true })
  })
  recordPid('web', child.pid)

  const result = await stopDetached({
    name: 'web',
    patterns: ['local-web.mjs'],
    timeoutMs: 200,
  })

  assert.equal(result.status, 'foreign')
  assert.equal(result.pid, child.pid)
  assert.equal(processAlive(child.pid), true)
  assert.equal(existsSync(pidPath('web')), false)
})

test('serves files from dist with an SPA fallback', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'clara-web-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  mkdirSync(join(dir, 'assets'))
  writeFileSync(join(dir, 'index.html'), '<html></html>')
  writeFileSync(join(dir, 'assets', 'app.js'), 'console.log(1)')

  assert.equal(distFile('/', dir), join(dir, 'index.html'))
  assert.equal(distFile('/assets/app.js', dir), join(dir, 'assets', 'app.js'))
  assert.equal(distFile('/project/session', dir), join(dir, 'index.html'))
  assert.equal(distFile('/missing.js', dir), undefined)
  assert.equal(distFile('/../secret', dir), undefined)
})
