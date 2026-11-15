import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { resolvePaths } from '../src/paths.ts'
import {
  adapterConfigPath,
  adapterDataDir,
  adapterEnv,
  adapterHasPairing,
  adapterRuntimeState,
  adapterStatePath,
  deleteAdapterRecord,
  readAdapterState,
  saveAdapterRecord,
  writeAdapterState,
  type AdapterInstallRecord,
} from '../src/adapters/state.ts'

const roots: string[] = []

function tempPaths(): ReturnType<typeof resolvePaths> {
  const root = mkdtempSync(join(tmpdir(), 'clara-adapter-state-'))
  roots.push(root)
  return resolvePaths({
    CLARA_CONFIG_DIR: join(root, 'config'),
    CLARA_DATA_DIR: join(root, 'data'),
    CLARA_CACHE_DIR: join(root, 'cache'),
  })
}

function record(overrides: Partial<AdapterInstallRecord> = {}): AdapterInstallRecord {
  return {
    kind: 'opencode',
    version: '1.2.3',
    platform: 'linux-x64',
    path: join('/data', 'adapters', 'opencode', '1.2.3'),
    installedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('adapter install records', () => {
  it('writes and reads a record atomically with owner-only permissions', () => {
    const paths = tempPaths()
    saveAdapterRecord(record(), paths)

    const file = adapterStatePath(paths)
    expect(statSync(file).mode & 0o777).toBe(0o600)
    expect(readAdapterState(paths).adapters.opencode?.version).toBe('1.2.3')
    expect(readdirSync(paths.configDir).some((name) => name.endsWith('.tmp'))).toBe(false)
  })

  it('drops unknown kinds and malformed records', () => {
    const paths = tempPaths()
    mkdirSync(paths.configDir, { recursive: true })
    writeFileSync(
      adapterStatePath(paths),
      JSON.stringify({
        schemaVersion: 1,
        adapters: {
          opencode: record({ kind: 'opencode' }),
          unknown: record({ kind: 'opencode' }),
          claude: { version: 1 },
        },
      })
    )
    expect(Object.keys(readAdapterState(paths).adapters)).toEqual(['opencode'])
  })

  it('treats missing or corrupt state as empty', () => {
    const paths = tempPaths()
    expect(readAdapterState(paths).adapters).toEqual({})
    mkdirSync(paths.configDir, { recursive: true })
    writeFileSync(adapterStatePath(paths), '{')
    expect(readAdapterState(paths).adapters).toEqual({})
  })

  it('removes one record without touching the others', () => {
    const paths = tempPaths()
    saveAdapterRecord(record(), paths)
    saveAdapterRecord(record({ kind: 'claude', path: '/data/claude' }), paths)
    deleteAdapterRecord('opencode', paths)
    expect(Object.keys(readAdapterState(paths).adapters)).toEqual(['claude'])
  })

  it('round-trips a staged entry and replayed install flags', () => {
    const paths = tempPaths()
    saveAdapterRecord(record({ entry: 'index.js', installArgs: ['--no-runner', '--mcp'] }), paths)
    expect(readAdapterState(paths).adapters.opencode).toMatchObject({
      entry: 'index.js',
      installArgs: ['--no-runner', '--mcp'],
    })
  })

  it('points the adapter at the CLI config and data directories', () => {
    const paths = tempPaths()
    const env = adapterEnv(paths, 'opencode')
    expect(env.CLARA_ADAPTER_CONFIG_DIR).toBe(join(paths.configDir, 'adapters', 'opencode'))
    expect(env.CLARA_ADAPTER_DATA_DIR).toBe(join(paths.dataDir, 'adapters', 'opencode'))
  })

  it('detects a saved adapter pairing', () => {
    const paths = tempPaths()
    expect(adapterHasPairing('opencode', paths)).toBe(false)
    mkdirSync(join(paths.configDir, 'adapters', 'opencode'), { recursive: true })
    writeFileSync(adapterConfigPath('opencode', paths), '{}')
    expect(adapterHasPairing('opencode', paths)).toBe(true)
  })

  it('round-trips pairedAt and lastError', () => {
    const paths = tempPaths()
    writeAdapterState(
      {
        schemaVersion: 1,
        adapters: {
          pi: record({
            kind: 'pi',
            pairedAt: '2026-01-02T00:00:00.000Z',
            lastError: 'boom',
          }),
        },
      },
      paths
    )
    expect(readAdapterState(paths).adapters.pi).toMatchObject({
      pairedAt: '2026-01-02T00:00:00.000Z',
      lastError: 'boom',
    })
  })
})

describe('adapter process state', () => {
  it('reports unknown without a pid file', () => {
    const env = { XDG_DATA_HOME: join(tempPaths().dataDir, 'xdg') }
    expect(adapterRuntimeState('opencode', { env })).toBe('unknown')
  })

  it('reports running or stopped from the adapter pid file', () => {
    const root = mkdtempSync(join(tmpdir(), 'clara-adapter-pid-'))
    roots.push(root)
    const env = { XDG_DATA_HOME: root }
    const dir = adapterDataDir('claude', env)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'adapter.pid'), '4242\n')

    expect(adapterRuntimeState('claude', { env, alive: () => true })).toBe('running')
    expect(adapterRuntimeState('claude', { env, alive: () => false })).toBe('stopped')
  })

  it('honors the explicit adapter data directory', () => {
    const root = mkdtempSync(join(tmpdir(), 'clara-adapter-pid-'))
    roots.push(root)
    mkdirSync(root, { recursive: true })
    writeFileSync(join(root, 'adapter.pid'), '7\n')
    expect(
      adapterRuntimeState('pi', { env: { CLARA_ADAPTER_DATA_DIR: root }, alive: () => true })
    ).toBe('running')
  })

  it('reports unknown for an invalid pid file', () => {
    const root = mkdtempSync(join(tmpdir(), 'clara-adapter-pid-'))
    roots.push(root)
    writeFileSync(join(root, 'adapter.pid'), 'not-a-pid')
    expect(
      adapterRuntimeState('pi', {
        env: { CLARA_ADAPTER_DATA_DIR: root },
        alive: () => true,
      })
    ).toBe('unknown')
  })
})
