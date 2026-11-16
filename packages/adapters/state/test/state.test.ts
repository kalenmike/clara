import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeAdapterProvenance } from '@clara/adapter-artifact'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  deleteAdapterRecord,
  discoverAdapterRecords,
  readAdapterRecords,
  readAdapterState,
  saveAdapterRecord,
  withDiscoveredAdapterRecords,
  type AdapterInstallRecord,
  type AdapterStatePaths,
} from '../src/index.ts'

let root: string
let paths: AdapterStatePaths

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'clara-adapter-state-'))
  paths = { configDir: join(root, 'config'), dataDir: join(root, 'data') }
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

function record(overrides: Partial<AdapterInstallRecord> = {}): AdapterInstallRecord {
  return {
    kind: 'opencode',
    version: '0.1.0',
    platform: 'linux-x64',
    path: join(paths.dataDir, 'adapters', 'opencode', '0.1.0'),
    installedAt: '2026-11-16T00:00:00.000Z',
    ...overrides,
  }
}

describe('adapter records', () => {
  it('writes and reads a valid record atomically', () => {
    saveAdapterRecord(record({ pairedAt: '2026-11-16T01:00:00.000Z' }), paths)
    const state = readAdapterState(paths, { kinds: ['opencode', 'claude', 'pi'] })
    expect(state.adapters.opencode).toMatchObject({
      kind: 'opencode',
      version: '0.1.0',
      pairedAt: '2026-11-16T01:00:00.000Z',
    })
  })

  it('ignores malformed and unknown records', () => {
    mkdirSync(paths.configDir, { recursive: true })
    writeFileSync(
      join(paths.configDir, 'adapters.json'),
      JSON.stringify({
        schemaVersion: 1,
        adapters: {
          opencode: { version: '0.1.0' },
          claude: { ...record(), kind: 'claude' },
          notakind: { ...record(), kind: 'notakind' },
        },
      })
    )
    const state = readAdapterState(paths, { kinds: ['opencode', 'claude', 'pi'] })
    expect(Object.keys(state.adapters)).toEqual(['claude'])
  })

  it('preserves other records when one is saved or deleted', () => {
    saveAdapterRecord(record(), paths)
    saveAdapterRecord(record({ kind: 'claude', version: '0.2.0' }), paths)
    deleteAdapterRecord('opencode', paths)
    const state = readAdapterState(paths)
    expect(state.adapters.opencode).toBeUndefined()
    expect(state.adapters.claude?.version).toBe('0.2.0')
  })
})

describe('adapter discovery', () => {
  it('rebuilds a record from a standalone version directory', () => {
    const versionRoot = join(paths.dataDir, 'adapters', 'opencode', '0.3.0')
    mkdirSync(versionRoot, { recursive: true })
    writeFileSync(join(versionRoot, 'clara-adapter-opencode'), 'binary')
    writeAdapterProvenance(versionRoot, {
      schemaVersion: 1,
      kind: 'opencode',
      version: '0.3.0',
      platform: 'linux-x64',
      source: 'local',
      installArgs: ['--no-runner'],
      installedAt: '2026-11-16T00:00:00.000Z',
    })
    mkdirSync(join(paths.configDir, 'adapters', 'opencode'), { recursive: true })
    writeFileSync(join(paths.configDir, 'adapters', 'opencode', 'config.json'), '{}')

    const found = discoverAdapterRecords({ paths, kinds: ['opencode', 'claude', 'pi'] })
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({
      kind: 'opencode',
      version: '0.3.0',
      platform: 'linux-x64',
      path: versionRoot,
      installArgs: ['--no-runner'],
    })
    expect(found[0]?.pairedAt).toBeTruthy()
  })

  it('picks the newest version and leaves a valid stored record alone', () => {
    for (const version of ['0.1.0', '0.2.0']) {
      const versionRoot = join(paths.dataDir, 'adapters', 'opencode', version)
      mkdirSync(versionRoot, { recursive: true })
      writeFileSync(join(versionRoot, 'clara-adapter-opencode'), 'binary')
      writeAdapterProvenance(versionRoot, {
        schemaVersion: 1,
        kind: 'opencode',
        version,
        platform: 'linux-x64',
        source: 'local',
        installedAt: '2026-11-16T00:00:00.000Z',
      })
    }
    const discovered = discoverAdapterRecords({ paths, kinds: ['opencode'] })
    expect(discovered[0]?.version).toBe('0.2.0')

    const stored = record({ version: '0.1.0' })
    mkdirSync(stored.path!, { recursive: true })
    const merged = withDiscoveredAdapterRecords(
      { schemaVersion: 1, adapters: { opencode: stored } },
      discovered
    )
    expect(merged.adapters.opencode?.version).toBe('0.1.0')
  })

  it('heals a stored record whose install directory is gone', () => {
    const discovered = record({
      version: '0.2.0',
      path: join(paths.dataDir, 'adapters', 'opencode', '0.2.0'),
    })
    const merged = withDiscoveredAdapterRecords(
      { schemaVersion: 1, adapters: { opencode: record({ path: join(root, 'missing') }) } },
      [discovered]
    )
    expect(merged.adapters.opencode?.version).toBe('0.2.0')
  })

  it('exposes discovered records through the merged read', () => {
    const versionRoot = join(paths.dataDir, 'adapters', 'pi', '0.1.0')
    mkdirSync(versionRoot, { recursive: true })
    writeFileSync(join(versionRoot, 'clara-adapter-pi'), 'binary')
    writeAdapterProvenance(versionRoot, {
      schemaVersion: 1,
      kind: 'pi',
      version: '0.1.0',
      platform: 'linux-x64',
      source: 'local',
      installedAt: '2026-11-16T00:00:00.000Z',
    })
    const state = readAdapterRecords(paths, ['opencode', 'claude', 'pi'])
    expect(state.adapters.pi?.version).toBe('0.1.0')
  })
})
