import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeInstallInfo, type ClaraPaths } from '@clara/release'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveClaraBinary, runClaraCommand } from '../src/clara-command.ts'

let root: string
let env: NodeJS.ProcessEnv
let paths: ClaraPaths

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'clara-adapter-cli-'))
  paths = {
    configDir: join(root, 'config'),
    dataDir: join(root, 'data'),
    cacheDir: join(root, 'cache'),
    logDir: join(root, 'logs'),
    stateFile: join(root, 'services.json'),
    supervisorPidFile: join(root, 'supervisor.pid'),
    stopRequestFile: join(root, 'stop.request'),
  }
  env = {
    ...process.env,
    CLARA_CONFIG_DIR: paths.configDir,
    CLARA_DATA_DIR: paths.dataDir,
    CLARA_CACHE_DIR: paths.cacheDir,
    PATH: join(root, 'empty-path'),
  }
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

function fakeBinary(version: string): string {
  const binary = join(
    paths.dataDir,
    'versions',
    version,
    process.platform === 'win32' ? 'clara.exe' : 'clara'
  )
  mkdirSync(join(paths.dataDir, 'versions', version), { recursive: true })
  writeFileSync(binary, 'binary')
  if (process.platform !== 'win32') chmodSync(binary, 0o755)
  return binary
}

describe('resolveClaraBinary', () => {
  it('prefers an explicit CLARA_BIN', () => {
    const explicit = join(root, 'explicit-clara')
    writeFileSync(explicit, 'binary')
    env.CLARA_BIN = explicit
    expect(resolveClaraBinary(env)).toEqual({ command: explicit, source: 'explicit' })
  })

  it('reads the install record and then the newest version directory', () => {
    const versioned = fakeBinary('0.2.0')
    writeInstallInfo(paths, {
      schemaVersion: 1,
      version: '0.2.0',
      channel: 'stable',
      installedAt: '2026-11-16T00:00:00.000Z',
      source: 'test',
    })
    expect(resolveClaraBinary(env)).toEqual({
      command: versioned,
      version: '0.2.0',
      source: 'install',
    })

    rmSync(join(paths.configDir, 'install.json'), { force: true })
    fakeBinary('0.3.0')
    expect(resolveClaraBinary(env)?.version).toBe('0.3.0')
  })

  it('finds a command on PATH last', () => {
    const directory = join(root, 'bin')
    mkdirSync(directory, { recursive: true })
    const binary = join(directory, process.platform === 'win32' ? 'clara.cmd' : 'clara')
    writeFileSync(binary, 'binary')
    if (process.platform !== 'win32') chmodSync(binary, 0o755)
    env.PATH = directory
    expect(resolveClaraBinary(env)).toEqual({ command: binary, source: 'path' })
  })
})

describe('runClaraCommand', () => {
  it('prints native status and an install hint when the CLI is absent', async () => {
    const nativeStatus = vi.fn()
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    await runClaraCommand({ name: 'opencode', nativeStatus, env }, ['status'])
    expect(nativeStatus).toHaveBeenCalledOnce()
    const output = log.mock.calls.flat().join('\n')
    expect(output).toContain('clara-adapter-opencode clara install')
    log.mockRestore()
  })

  it('runs the resolved command and forwards its exit code', async () => {
    if (process.platform === 'win32') return
    const marker = join(root, 'ran')
    const script = join(root, 'fake-clara')
    writeFileSync(script, `#!/bin/sh\nprintf '%s' "$1" > "${marker}"\n`)
    chmodSync(script, 0o755)
    env.CLARA_BIN = script
    await runClaraCommand({ name: 'opencode', nativeStatus: vi.fn(), env }, [marker])
    expect(resolveClaraBinary(env)?.source).toBe('explicit')
    expect(existsSync(marker)).toBe(true)
  })

  it('prints help without downloading when no command is present', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    await runClaraCommand({ name: 'pi', nativeStatus: vi.fn(), env }, [])
    expect(log.mock.calls.flat().join('\n')).toContain('clara-adapter-pi clara')
    log.mockRestore()
  })
})
