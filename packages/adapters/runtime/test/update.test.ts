import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readAdapterProvenance, writeAdapterProvenance } from '@clara/adapter-artifact'
import {
  AdapterUpdateError,
  adapterUpdateStatusPath,
  parseManifest,
  readAdapterUpdateStatus,
  stageAdapterUpdate,
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

describe('adapter update staging', () => {
  it('downloads, verifies, and extracts a newer release', async () => {
    const base = tempDir()
    const root = join(base, 'opencode', '0.1.0')
    mkdirSync(root, { recursive: true })
    writeFileSync(join(root, 'clara-adapter-opencode'), 'old')
    writeAdapterProvenance(root, {
      schemaVersion: 1,
      kind: 'opencode',
      version: '0.1.0',
      platform: 'linux-x64',
      source: 'registry',
      registryUrl: 'http://127.0.0.1:1/adapters',
      installedAt: new Date().toISOString(),
    })

    const artifactDir = tempDir()
    writeFileSync(join(artifactDir, 'clara-adapter-opencode'), '#!/bin/sh\nexit 0\n', {
      mode: 0o755,
    })
    const archive = join(tempDir(), 'adapter.tar.gz')
    const tar = spawnSync('tar', ['-czf', archive, '-C', artifactDir, '.'])
    expect(tar.status).toBe(0)
    const bytes = readFileSync(archive)
    const sha256 = createHash('sha256').update(bytes).digest('hex')

    let port = 0
    const server = createServer((request, response) => {
      if (request.url === '/adapters/opencode/manifest.json') {
        response.setHeader('content-type', 'application/json')
        response.end(
          JSON.stringify({
            schemaVersion: 1,
            harness: 'opencode',
            version: '0.2.0',
            artifacts: {
              'linux-x64': {
                url: `http://127.0.0.1:${port}/adapter.tar.gz`,
                sha256,
                size: bytes.length,
              },
            },
          })
        )
        return
      }
      if (request.url === '/adapter.tar.gz') {
        response.setHeader('content-type', 'application/octet-stream')
        response.end(bytes)
        return
      }
      response.statusCode = 404
      response.end()
    })
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const address = server.address()
        port = typeof address === 'object' && address ? address.port : 0
        resolve()
      })
    })

    const adapterPaths = paths(base)
    adapterPaths.dataDir = join(base, 'data')
    let planPath: string | undefined
    try {
      const provenance = readAdapterProvenance(root)
      expect(provenance).toBeDefined()
      writeAdapterProvenance(root, {
        ...provenance!,
        registryUrl: `http://127.0.0.1:${port}/adapters`,
      })
      const result = await stageAdapterUpdate(
        {
          kind: 'opencode',
          label: 'OpenCode',
          version: '0.1.0',
          paths: adapterPaths,
          containerized: false,
          root,
          platform: 'linux-x64',
          supervise: (_paths, plan) => {
            planPath = plan
          },
        },
        '0.2.0'
      )
      expect(result).toEqual({ from: '0.1.0', to: '0.2.0' })
      expect(existsSync(join(base, 'opencode', '0.2.0', 'clara-adapter-opencode'))).toBe(true)
      expect(readAdapterUpdateStatus(adapterPaths).state).toBe('restarting')
      expect(planPath).toBeDefined()
      expect(JSON.parse(readFileSync(planPath!, 'utf8'))).toMatchObject({
        from: '0.1.0',
        to: '0.2.0',
        newRoot: join(base, 'opencode', '0.2.0'),
      })
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })
})
