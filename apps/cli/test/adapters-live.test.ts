import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { adapterHubLinks } from '../src/adapters/hubs.ts'
import { readAdapterLiveState, type AdapterLiveState } from '../src/adapters/live.ts'
import type { AdapterListEntry } from '../src/commands/adapters.ts'
import { resolvePaths } from '../src/paths.ts'

const dirs: string[] = []

function localPaths() {
  const root = mkdtempSync(join(tmpdir(), 'clara-adapter-live-'))
  dirs.push(root)
  return resolvePaths({
    CLARA_CONFIG_DIR: join(root, 'config'),
    CLARA_DATA_DIR: join(root, 'data'),
    CLARA_CACHE_DIR: join(root, 'cache'),
  })
}

function live(overrides: Partial<AdapterLiveState> = {}): AdapterLiveState {
  return {
    pid: 42,
    startedAt: 1_000,
    updatedAt: 2_000,
    harnessId: 'harness-a',
    hub: {
      url: 'wss://relay.example/room/abc',
      status: 'authenticated',
      connected: true,
      authenticated: true,
    },
    harness: {
      url: 'http://127.0.0.1:4096',
      reachable: true,
      code: 'ok',
    },
    ...overrides,
  }
}

function entry(kind: 'opencode' | 'claude', state: AdapterLiveState): AdapterListEntry {
  return {
    kind,
    version: '0.1.0',
    platform: 'linux-x64',
    path: `/tmp/${kind}`,
    installedAt: new Date().toISOString(),
    pairedAt: new Date().toISOString(),
    state: 'running',
    live: state,
  }
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('adapter live state', () => {
  it('reads the state the adapter writes', () => {
    const paths = localPaths()
    const path = join(paths.dataDir, 'adapters', 'opencode', 'state.json')
    mkdirSync(join(paths.dataDir, 'adapters', 'opencode'), { recursive: true })
    writeFileSync(
      path,
      JSON.stringify(
        live({
          hubInfo: {
            version: '0.1.0',
            protocol: 1,
            endpoints: { web: 'https://clara.example.com' },
            updatedAt: 1_900,
          },
        })
      )
    )

    const state = readAdapterLiveState('opencode', paths)
    expect(state?.hub.url).toBe('wss://relay.example/room/abc')
    expect(state?.hubInfo?.endpoints?.web).toBe('https://clara.example.com')
  })

  it('ignores a missing or malformed state file', () => {
    const paths = localPaths()
    expect(readAdapterLiveState('opencode', paths)).toBeUndefined()
    const directory = join(paths.dataDir, 'adapters', 'opencode')
    mkdirSync(directory, { recursive: true })
    writeFileSync(join(directory, 'state.json'), '{not-json')
    expect(readAdapterLiveState('opencode', paths)).toBeUndefined()
  })
})

describe('hub links', () => {
  it('groups adapters by hub and merges their endpoints', () => {
    const links = adapterHubLinks([
      entry(
        'opencode',
        live({
          hubInfo: {
            version: '0.1.0',
            protocol: 1,
            room: 'abc',
            endpoints: { web: 'https://clara.example.com', engine: 'http://127.0.0.1:8789' },
            updatedAt: 1_900,
          },
        })
      ),
      entry(
        'claude',
        live({
          hubInfo: {
            version: '0.1.0',
            protocol: 1,
            endpoints: { hub: 'http://127.0.0.1:8788' },
            updatedAt: 1_950,
          },
        })
      ),
    ])

    expect(links).toHaveLength(1)
    expect(links[0]?.adapters).toEqual(['opencode', 'claude'])
    expect(links[0]?.authenticated).toBe(true)
    expect(links[0]?.endpoints).toEqual({
      web: 'https://clara.example.com',
      hub: 'http://127.0.0.1:8788',
      engine: 'http://127.0.0.1:8789',
    })
    expect(links[0]?.updatedAt).toBe(1_950)
  })

  it('does not report a stopped adapter link as connected', () => {
    const links = adapterHubLinks([{ ...entry('opencode', live()), state: 'stopped' }])
    expect(links[0]?.status).toBe('stopped')
    expect(links[0]?.authenticated).toBe(false)
    expect(links[0]?.connected).toBe(false)
  })

  it('keeps distinct hubs apart and clears errors once authenticated', () => {
    const links = adapterHubLinks([
      entry(
        'opencode',
        live({
          hub: {
            url: 'wss://relay.example/room/one',
            status: 'offline',
            connected: false,
            authenticated: false,
            lastError: 'The relay refused the connection',
          },
        })
      ),
      entry(
        'claude',
        live({
          hub: {
            url: 'wss://relay.example/room/two',
            status: 'authenticated',
            connected: true,
            authenticated: true,
            lastError: 'stale',
          },
        })
      ),
    ])

    expect(links).toHaveLength(2)
    expect(links[0]?.lastError).toBe('The relay refused the connection')
    expect(links[1]?.lastError).toBeUndefined()
  })
})
