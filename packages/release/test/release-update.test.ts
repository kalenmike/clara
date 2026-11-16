import { spawnSync } from 'node:child_process'
import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resolvePaths, type ClaraPaths } from '../src/paths.ts'
import { platformKey } from '../src/platform.ts'
import { applyLocalArchive, installLatest } from '../src/update.ts'
import { readInstallInfo } from '../src/version-store.ts'

let root: string
let paths: ClaraPaths
let binDir: string
let archive: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'clara-update-'))
  paths = resolvePaths({
    CLARA_CONFIG_DIR: join(root, 'config'),
    CLARA_DATA_DIR: join(root, 'data'),
    CLARA_CACHE_DIR: join(root, 'cache'),
  } as NodeJS.ProcessEnv)
  binDir = join(root, 'bin')

  const staging = join(root, 'staging')
  mkdirSync(staging, { recursive: true })
  writeFileSync(join(staging, 'clara'), '#!/bin/sh\necho clara\n', { mode: 0o755 })
  archive = join(root, 'clara-linux-x64.tar.gz')
  const tar = spawnSync('tar', ['-czf', archive, '-C', staging, 'clara'])
  if (tar.status !== 0) throw new Error('tar is required for this test')
})

afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('local archive install', () => {
  it('stages, activates, and records a release archive', async () => {
    const result = await applyLocalArchive({
      paths,
      archive,
      version: '0.2.0',
      channel: 'stable',
      binDir,
    })
    expect(result.version).toBe('0.2.0')
    expect(readFileSync(result.binary, 'utf8')).toContain('echo clara')
    expect(readInstallInfo(paths)?.version).toBe('0.2.0')
  })

  it('installs the newest signed release for the bootstrap', async () => {
    const platform = platformKey()
    if (!platform) return
    const keys = generateKeyPairSync('ed25519')
    const publicKey = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString()
    const payload = readFileSync(archive)
    let manifest = Buffer.alloc(0)
    let signature = Buffer.alloc(0)
    const server = createServer((request, response) => {
      if (request.url === '/manifest.json') {
        response.end(manifest)
        return
      }
      if (request.url === '/manifest.json.sig') {
        response.end(`${signature.toString('base64')}\n`)
        return
      }
      if (request.url === '/clara.tar.gz') {
        response.end(payload)
        return
      }
      response.statusCode = 404
      response.end()
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    try {
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('no server address')
      const url = `http://127.0.0.1:${address.port}`
      const wire = {
        schemaVersion: 2,
        channel: 'stable',
        generatedAt: '2026-11-16T00:00:00.000Z',
        cli: {
          version: '0.2.0',
          tag: 'v0.2.0',
          publishedAt: '2026-11-16T00:00:00.000Z',
          artifacts: {
            [platform]: {
              url: `${url}/clara.tar.gz`,
              sha256: createHash('sha256').update(payload).digest('hex'),
              size: payload.byteLength,
            },
          },
        },
      }
      manifest = Buffer.from(JSON.stringify(wire))
      signature = sign(null, manifest, keys.privateKey)
      const result = await installLatest({
        paths,
        binDir,
        baseUrl: url,
        publicKey,
        allowInsecure: true,
      })
      expect(result.version).toBe('0.2.0')
      expect(readInstallInfo(paths)?.version).toBe('0.2.0')
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((cause) => (cause ? reject(cause) : resolve()))
      )
    }
  })

  it('records the previous version on a later install', async () => {
    await applyLocalArchive({ paths, archive, version: '0.2.0', binDir })
    await applyLocalArchive({ paths, archive, version: '0.3.0', binDir })
    const info = readInstallInfo(paths)
    expect(info?.version).toBe('0.3.0')
    expect(info?.previous).toBe('0.2.0')
  })

  it('rejects an archive without the clara binary', async () => {
    const empty = join(root, 'empty')
    mkdirSync(empty)
    writeFileSync(join(empty, 'README.txt'), 'nothing here')
    const bad = join(root, 'bad.tar.gz')
    const tar = spawnSync('tar', ['-czf', bad, '-C', empty, 'README.txt'])
    expect(tar.status).toBe(0)
    await expect(applyLocalArchive({ paths, archive: bad, version: '9.9.9' })).rejects.toThrow(
      /did not contain/
    )
  })
})
