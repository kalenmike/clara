import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { adapterStatePath } from '../src/config.ts'
import { readState, removeState, writeState, type AdapterLiveState } from '../src/state.ts'

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
    hub: {
      url: 'ws://127.0.0.1:8788/ws',
      status: 'authenticated',
      connected: true,
      authenticated: true,
      lastFrameAt: 1_900,
    },
    opencode: {
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
    const env = { CLARA_ADAPTER_DATA_DIR: dataDir() }
    const state = sample()
    writeState(state, env)
    expect(readState(env)).toEqual(state)
  })

  it('ignores a malformed state file', () => {
    const env = { CLARA_ADAPTER_DATA_DIR: dataDir() }
    writeFileSync(adapterStatePath(env), '{not-json', 'utf8')
    expect(readState(env)).toBeUndefined()
  })

  it('removes the state file', () => {
    const env = { CLARA_ADAPTER_DATA_DIR: dataDir() }
    writeState(sample(), env)
    removeState(env)
    expect(readState(env)).toBeUndefined()
  })
})
