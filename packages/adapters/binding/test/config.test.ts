import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { engineConfigPath, engineServiceConfig } from '../src/config.ts'

function withDataDir(run: (env: NodeJS.ProcessEnv) => void): void {
  const root = mkdtempSync(join(tmpdir(), 'clara-binding-'))
  const env = {
    ...process.env,
    XDG_DATA_HOME: join(root, 'share'),
    CLARA_ENGINE_URL: '',
    CLARA_ORCHESTRATION_URL: '',
    CLARA_ENGINE_TOKEN: '',
    CLARA_ORCHESTRATION_TOKEN: '',
    CLARA_ENGINE_TOKEN_FILE: '',
    CLARA_ORCHESTRATION_TOKEN_FILE: '',
    CLARA_DATA_DIR: '',
  }
  try {
    run(env)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test('reads the engine endpoint the adapter runtime wrote', () => {
  withDataDir((env) => {
    const path = engineConfigPath(env)
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(
      path,
      JSON.stringify({ enabled: true, mode: 'direct', url: 'http://host.docker.internal:8789' })
    )
    assert.deepEqual(engineServiceConfig(env), {
      url: 'http://host.docker.internal:8789',
      token: '',
    })
  })
})

test('uses the local gateway token in proxy mode', () => {
  withDataDir((env) => {
    const path = engineConfigPath(env)
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(
      path,
      JSON.stringify({
        enabled: true,
        mode: 'proxy',
        url: 'http://127.0.0.1:53124',
        token: 'local-gateway-token',
      })
    )
    assert.deepEqual(engineServiceConfig(env), {
      url: 'http://127.0.0.1:53124',
      token: 'local-gateway-token',
    })
  })
})

test('keeps the environment as the CI override', () => {
  withDataDir((env) => {
    const path = engineConfigPath(env)
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, JSON.stringify({ enabled: true, mode: 'proxy', url: 'http://127.0.0.1' }))
    assert.deepEqual(
      engineServiceConfig({
        ...env,
        CLARA_ENGINE_URL: 'http://engine.example:9000',
        CLARA_ENGINE_TOKEN: 'ci-token',
      }),
      { url: 'http://engine.example:9000', token: 'ci-token' }
    )
  })
})
