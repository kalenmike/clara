import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  AdapterUpdateError,
  adapterUpdateStatusPath,
  parseManifest,
  readAdapterUpdateStatus,
} from '../src/index.ts'

const roots: string[] = []

function tempDir(): string {
  const root = mkdtempSync(join(tmpdir(), 'clara-adapter-update-'))
  roots.push(root)
  return root
}

function paths(root: string) {
  return {
    name: 'opencode',
    configDir: join(root, 'config'),
    dataDir: join(root, 'data'),
    configPath: join(root, 'config', 'config.json'),
    identityPath: join(root, 'data', 'identity.json'),
    logPath: join(root, 'data', 'adapter.log'),
    pidPath: join(root, 'data', 'adapter.pid'),
    statePath: join(root, 'data', 'state.json'),
  }
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('adapter update manifest', () => {
  it('accepts the registry shape and keeps valid artifacts', () => {
    const manifest = parseManifest(
      {
        schemaVersion: 1,
        harness: 'opencode',
        version: '0.2.0',
        artifacts: {
          'linux-x64': { url: 'https://example.test/a.tar.gz', sha256: 'a'.repeat(64), size: 12 },
          'bad-target': { url: 'https://example.test/b.tar.gz', sha256: 'nope' },
        },
      },
      'opencode'
    )
    expect(manifest.version).toBe('0.2.0')
    expect(Object.keys(manifest.artifacts)).toEqual(['linux-x64'])
  })

  it('rejects the wrong harness and a malformed version', () => {
    expect(() =>
      parseManifest({ schemaVersion: 1, harness: 'pi', version: '0.2.0' }, 'opencode')
    ).toThrow(AdapterUpdateError)
    expect(() =>
      parseManifest(
        { schemaVersion: 1, harness: 'opencode', version: 'latest', artifacts: {} },
        'opencode'
      )
    ).toThrow(AdapterUpdateError)
  })
})

describe('adapter update status', () => {
  it('reads idle when no update has run', () => {
    const status = readAdapterUpdateStatus(paths(tempDir()))
    expect(status.state).toBe('idle')
  })

  it('reads the recorded status and ignores a malformed record', () => {
    const adapterPaths = paths(tempDir())
    mkdirSync(adapterPaths.dataDir, { recursive: true })
    writeFileSync(
      adapterUpdateStatusPath(adapterPaths),
      JSON.stringify({
        schemaVersion: 1,
        state: 'rolled-back',
        from: '0.1.0',
        to: '0.2.0',
        startedAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
        error: 'did not authenticate',
        rolledBack: true,
      })
    )
    expect(readAdapterUpdateStatus(adapterPaths)).toMatchObject({
      state: 'rolled-back',
      from: '0.1.0',
      to: '0.2.0',
      rolledBack: true,
    })

    writeFileSync(adapterUpdateStatusPath(adapterPaths), '{"schemaVersion":2}')
    expect(readAdapterUpdateStatus(adapterPaths).state).toBe('idle')
  })
})
