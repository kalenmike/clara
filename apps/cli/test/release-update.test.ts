import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resolvePaths, type ClaraPaths } from '../src/paths.ts'
import { applyLocalArchive } from '../src/release/update.ts'
import { readInstallInfo } from '../src/release/version-store.ts'

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
