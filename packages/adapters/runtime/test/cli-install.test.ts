import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readAdapterRecords } from '@clara/adapter-state'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runAdapterCli, type AdapterDefinition } from '../src/index.ts'
import { adapterPaths } from '../src/paths.ts'
import type { AdapterConfig } from '../src/types.ts'

let root: string
let env: Record<string, string>
let originalArgv: string[]
let originalEnv: NodeJS.ProcessEnv

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'clara-adapter-cli-install-'))
  env = {
    CLARA_CONFIG_DIR: join(root, 'config'),
    CLARA_DATA_DIR: join(root, 'data'),
    CLARA_BIN_DIR: join(root, 'bin'),
    CLARA_ADAPTER_CONFIG_DIR: join(root, 'config', 'adapters', 'fake'),
    CLARA_ADAPTER_DATA_DIR: join(root, 'data', 'adapters', 'fake'),
  }
  originalArgv = process.argv
  originalEnv = { ...process.env }
  Object.assign(process.env, env)
})
afterEach(() => {
  process.argv = originalArgv
  for (const key of Object.keys(env)) delete process.env[key]
  Object.assign(process.env, originalEnv)
  rmSync(root, { recursive: true, force: true })
})

type Harness = { fake: { url: string } }

function definition(): AdapterDefinition<Harness> {
  return {
    name: 'fake',
    version: '0.1.0',
    label: 'Fake',
    capabilities: {},
    paths: adapterPaths('fake', process.env),
    probe: async () => ({ ok: true, code: 'ok', latencyMs: 0 }),
    createApp: () => {
      throw new Error('serve is not used in this test')
    },
    describe: () => ({ url: 'http://127.0.0.1:1' }),
    resolveHarness: async () => ({ fake: { url: 'http://127.0.0.1:1' } }),
    install: async (_args, helpers) => {
      helpers.writeConfig({
        wsUrl: 'ws://127.0.0.1:1',
        harnessId: 'harness',
        adapterId: 'adapter',
        key: 'key',
        fake: { url: 'http://127.0.0.1:1' },
        label: 'Fake',
      } as AdapterConfig<Harness>)
    },
  }
}

describe('adapter CLI install', () => {
  it('writes the host record after a standalone install', async () => {
    const script = join(root, 'src', 'index.js')
    mkdirSync(join(root, 'src'), { recursive: true })
    writeFileSync(script, '')
    process.argv = [process.execPath, script, 'install']
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      await runAdapterCli(definition(), ['install'])
    } finally {
      log.mockRestore()
    }

    const state = readAdapterRecords(
      { configDir: env.CLARA_CONFIG_DIR!, dataDir: env.CLARA_DATA_DIR! },
      ['fake']
    )
    expect(state.adapters.fake).toMatchObject({
      kind: 'fake',
      version: '0.1.0',
      path: join(root, 'src'),
      entry: 'index.js',
    })
    expect(state.adapters.fake?.pairedAt).toBeTruthy()
  })

  it('removes the record on uninstall', async () => {
    const script = join(root, 'src', 'index.js')
    mkdirSync(join(root, 'src'), { recursive: true })
    writeFileSync(script, '')
    process.argv = [process.execPath, script, 'install']
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      await runAdapterCli(definition(), ['install'])
      await runAdapterCli(definition(), ['uninstall'])
    } finally {
      log.mockRestore()
    }
    const state = readAdapterRecords(
      { configDir: env.CLARA_CONFIG_DIR!, dataDir: env.CLARA_DATA_DIR! },
      ['fake']
    )
    expect(state.adapters.fake).toBeUndefined()
  })
})
