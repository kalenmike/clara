import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resolvePaths, type ClaraPaths } from '../src/paths.ts'
import {
  activateVersion,
  compareVersions,
  pruneVersions,
  readInstallInfo,
  stageBinary,
  writeInstallInfo,
} from '../src/release/version-store.ts'

let root: string
let paths: ClaraPaths
let binDir: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'clara-store-'))
  paths = resolvePaths({
    CLARA_CONFIG_DIR: join(root, 'config'),
    CLARA_DATA_DIR: join(root, 'data'),
    CLARA_CACHE_DIR: join(root, 'cache'),
  } as NodeJS.ProcessEnv)
  binDir = join(root, 'bin')
})

afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('version comparison', () => {
  it('orders releases and prereleases', () => {
    expect(compareVersions('0.2.0', '0.1.9')).toBeGreaterThan(0)
    expect(compareVersions('0.2.0', '0.2.0')).toBe(0)
    expect(compareVersions('0.2.0-beta.1', '0.2.0')).toBeLessThan(0)
    expect(compareVersions('0.2.0-beta.2', '0.2.0-beta.1')).toBeGreaterThan(0)
    expect(compareVersions('0.2.0-beta.10', '0.2.0-beta.9')).toBeGreaterThan(0)
  })
})

describe('version store', () => {
  it('stages a binary and activates it through the bin directory', () => {
    const staged = stageBinary(paths, '0.2.0', Buffer.from('binary'))
    expect(readFileSync(staged, 'utf8')).toBe('binary')
    const active = activateVersion(paths, '0.2.0', binDir)
    expect(readFileSync(active, 'utf8')).toBe('binary')
  })

  it('records the current and previous versions', () => {
    writeInstallInfo(paths, {
      schemaVersion: 1,
      version: '0.2.0',
      channel: 'stable',
      installedAt: new Date().toISOString(),
      source: 'test',
      previous: '0.1.0',
    })
    expect(readInstallInfo(paths)?.version).toBe('0.2.0')
    expect(readInstallInfo(paths)?.previous).toBe('0.1.0')
  })

  it('prunes versions that are not kept', () => {
    stageBinary(paths, '0.1.0', Buffer.from('old'))
    stageBinary(paths, '0.2.0', Buffer.from('new'))
    pruneVersions(paths, ['0.2.0'])
    expect(() => readFileSync(join(paths.dataDir, 'versions', '0.1.0', 'clara'))).toThrow()
  })

  it('refuses to activate a missing version', () => {
    expect(() => activateVersion(paths, '9.9.9', binDir)).toThrow()
  })
})

describe('install info corruption', () => {
  it('ignores a malformed file', () => {
    mkdirSync(join(root, 'config'), { recursive: true })
    writeFileSync(join(root, 'config', 'install.json'), '{')
    expect(readInstallInfo(paths)).toBeUndefined()
  })
})
