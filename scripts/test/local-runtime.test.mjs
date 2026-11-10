import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { parseMode, pidPath, readPid, stateDir } from '../lib/local-runtime.mjs'
import { distFile } from '../lib/local-web.mjs'

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
