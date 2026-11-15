import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  buildInfoEnv,
  composeArgs,
  composeFile,
  envFile,
  webPort,
  webURL,
} from '../src/lib/web-control.mjs'

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

test('build info comes from the host checkout', () => {
  const root = mkdtempSync(join(tmpdir(), 'clara-web-build-info-'))
  try {
    execFileSync('git', ['init', '--quiet'], { cwd: root })
    writeFileSync(join(root, 'file.txt'), 'one\n')
    execFileSync('git', ['add', 'file.txt'], { cwd: root })
    execFileSync(
      'git',
      [
        '-c',
        'user.name=Clara Test',
        '-c',
        'user.email=clara@example.com',
        'commit',
        '--quiet',
        '-m',
        'init',
      ],
      { cwd: root }
    )

    const clean = buildInfoEnv(root)
    assert.match(clean.CLARA_COMMIT, /^[0-9a-f]{8,40}$/)
    assert.equal(clean.CLARA_DIRTY, '0')
    assert.match(clean.CLARA_VERSION, /^0\.0\.0-dev\+[0-9a-f]+$/)

    writeFileSync(join(root, 'file.txt'), 'two\n')
    assert.equal(buildInfoEnv(root).CLARA_DIRTY, '1')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
