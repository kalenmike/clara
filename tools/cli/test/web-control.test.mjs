import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { composeArgs, composeFile, envFile, webPort, webURL } from '../src/lib/web-control.mjs'

test('web port defaults to 8080 and accepts an override', () => {
  assert.equal(webPort({}), 8080)
  assert.equal(webPort({ CLARA_WEB_PORT: '9090' }), 9090)
  assert.equal(webPort({ CLARA_WEB_PORT: 'not-a-port' }), 8080)
  assert.equal(webPort({ CLARA_WEB_PORT: '0' }), 8080)
})

test('web URL follows the configured port', () => {
  assert.equal(webURL({}), 'http://127.0.0.1:8080')
  assert.equal(webURL({ CLARA_WEB_PORT: '9090' }), 'http://127.0.0.1:9090')
})

test('compose args use infra/docker/web.compose.yml and load infra/docker/.env when present', () => {
  const root = mkdtempSync(join(tmpdir(), 'clara-web-control-'))
  try {
    assert.equal(composeFile(root), join(root, 'infra', 'docker', 'web.compose.yml'))
    assert.equal(envFile(root), join(root, 'infra', 'docker', '.env'))
    assert.deepEqual(composeArgs(['up', '-d', 'web'], root), [
      'compose',
      '-f',
      join(root, 'infra', 'docker', 'web.compose.yml'),
      'up',
      '-d',
      'web',
    ])

    mkdirSync(join(root, 'infra', 'docker'), { recursive: true })
    writeFileSync(join(root, 'infra', 'docker', '.env'), 'VITE_CLARA_WS_URL=wss://relay.example\n')
    assert.deepEqual(composeArgs(['down'], root), [
      'compose',
      '--env-file',
      join(root, 'infra', 'docker', '.env'),
      '-f',
      join(root, 'infra', 'docker', 'web.compose.yml'),
      'down',
    ])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
