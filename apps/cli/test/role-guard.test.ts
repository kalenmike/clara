import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { saveAdapterRecord } from '../src/adapters/state.ts'
import { runAdapterInstall } from '../src/commands/adapter-install.ts'
import { runServiceCommand } from '../src/commands/maintenance.ts'
import { runPair } from '../src/commands/pair.ts'
import {
  adapterInstallGuard,
  logsGuard,
  pairingGuard,
  runnerStartGuard,
  serviceInstallGuard,
  stackGuard,
} from '../src/commands/role-guard.ts'
import { runRunnerStart } from '../src/commands/runner.ts'
import { runLogs, runRestart, runStart, runStatus, runStop } from '../src/commands/service.ts'

const dirs: string[] = []
const original = {
  config: process.env.CLARA_CONFIG_DIR,
  data: process.env.CLARA_DATA_DIR,
  cache: process.env.CLARA_CACHE_DIR,
}

function useAdapterHost(): void {
  const root = mkdtempSync(join(tmpdir(), 'clara-role-guard-'))
  dirs.push(root)
  process.env.CLARA_CONFIG_DIR = join(root, 'config')
  process.env.CLARA_DATA_DIR = join(root, 'data')
  process.env.CLARA_CACHE_DIR = join(root, 'cache')
  mkdirSync(process.env.CLARA_CONFIG_DIR, { recursive: true })
  saveAdapterRecord({
    kind: 'opencode',
    version: '0.1.0',
    platform: 'linux-x64',
    path: join(root, 'opencode'),
    installedAt: new Date().toISOString(),
    pairedAt: new Date().toISOString(),
  })
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  restore('CLARA_CONFIG_DIR', original.config)
  restore('CLARA_DATA_DIR', original.data)
  restore('CLARA_CACHE_DIR', original.cache)
})

describe('adapter-host guards', () => {
  it('describes the hub host and the setup override', () => {
    expect(stackGuard('adapter', 'start')).toContain('hub host')
    expect(stackGuard('adapter', 'start')).toContain('clara setup')
    expect(stackGuard('hub', 'start')).toBeUndefined()
    expect(logsGuard('adapter')).toContain('adapter logs')
    expect(pairingGuard('adapter', 'hub')).toContain('clara pair hub')
    expect(pairingGuard('adapter', 'adapter')).toContain('clara pair adapter')
    expect(adapterInstallGuard('adapter', 'opencode')).toContain('--pair <code>')
    expect(serviceInstallGuard('adapter')).toContain('no stack login service')
    expect(runnerStartGuard('adapter')).toContain('hub host')
  })

  it('refuses the local stack and pairing commands', async () => {
    useAdapterHost()
    const errors: string[] = []
    const spy = vi.spyOn(console, 'error').mockImplementation((...parts) => {
      errors.push(parts.map(String).join(' '))
    })
    const logs = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      await expect(runStart([])).resolves.toBe(1)
      await expect(runStop([])).resolves.toBe(1)
      await expect(runRestart([])).resolves.toBe(1)
      await expect(runLogs([])).resolves.toBe(1)
      await expect(runPair(['hub'])).resolves.toBe(1)
      await expect(runPair(['adapter', '--harness', 'opencode'])).resolves.toBe(1)
      await expect(runAdapterInstall(['opencode'])).resolves.toBe(1)
      expect(runServiceCommand(['install'])).toBe(1)
      await expect(runRunnerStart([])).resolves.toBe(1)
      expect(errors.join('\n')).toContain('hub host')
    } finally {
      spy.mockRestore()
      logs.mockRestore()
    }
  })

  it('still renders remote status without probing a local stack', async () => {
    useAdapterHost()
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      await expect(runStatus([])).resolves.toBe(0)
    } finally {
      log.mockRestore()
    }
  })
})

function restore(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}
