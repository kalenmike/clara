import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { adapterPaths } from '../src/paths.ts'
import { readState, removeState, writeState } from '../src/state.ts'
import type { AdapterLiveState } from '../src/types.ts'

const dirs: string[] = []

function dataDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'clara-adapter-state-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function sample(): AdapterLiveState {
  return {
    pid: 42,
    startedAt: 1_000,
    updatedAt: 2_000,
    harnessId: 'harness-a',
    hubInfo: {
      version: '0.1.0',
      protocol: 1,
      room: 'room-a',
      endpoints: {
        web: 'https://clara.example.com',
        hub: 'http://127.0.0.1:8788',
        engine: 'http://127.0.0.1:8789',
      },
      updatedAt: 1_990,
    },
    hub: {
      url: 'ws://127.0.0.1:8788/ws',
      status: 'authenticated',
      connected: true,
      authenticated: true,
      lastFrameAt: 1_900,
    },
    harness: {
      url: 'http://127.0.0.1:4096',
      reachable: true,
      version: '2.1.1',
      code: 'ok',
      latencyMs: 12,
      checkedAt: 1_950,
    },
  }
}

describe('adapter live state', () => {
  it('round-trips the transport and harness health', () => {
    const path = adapterPaths('opencode', { CLARA_ADAPTER_DATA_DIR: dataDir() }).statePath
    const state = sample()
    writeState(path, state)
    expect(readState(path)).toEqual(state)
  })

  it('ignores a malformed state file', () => {
    const path = adapterPaths('opencode', { CLARA_ADAPTER_DATA_DIR: dataDir() }).statePath
    writeFileSync(path, '{not-json', 'utf8')
    expect(readState(path)).toBeUndefined()
  })

  it('removes the state file', () => {
    const path = adapterPaths('opencode', { CLARA_ADAPTER_DATA_DIR: dataDir() }).statePath
    writeState(path, sample())
    removeState(path)
    expect(readState(path)).toBeUndefined()
  })
})
