import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { adapterBinaryName, detectAdapterTarget } from '@clara/adapter-artifact'
import { readAdapterRecords } from '@clara/adapter-state'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  ensureAdapterRecord,
  forgetAdapterInstall,
  recordAdapterInstall,
} from '../src/install-record.ts'

let root: string
let env: NodeJS.ProcessEnv
let binDir: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'clara-adapter-record-'))
  binDir = join(root, 'bin')
  env = {
    ...process.env,
    CLARA_CONFIG_DIR: join(root, 'config'),
    CLARA_DATA_DIR: join(root, 'data'),
    CLARA_BIN_DIR: binDir,
    XDG_CONFIG_HOME: join(root, 'xdg-config'),
    XDG_DATA_HOME: join(root, 'xdg-data'),
  }
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

function paths() {
  return { configDir: env.CLARA_CONFIG_DIR!, dataDir: env.CLARA_DATA_DIR! }
}

function nativeRoot(version = '0.1.0'): string {
  const dir = join(env.CLARA_DATA_DIR!, 'adapters', 'opencode', version)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, adapterBinaryName('opencode', detectAdapterTarget())), 'binary')
  return dir
}

describe('adapter install record', () => {
  it('records a JS install without linking a command', () => {
    const dir = join(root, 'src')
    mkdirSync(dir, { recursive: true })
    const entry = join(dir, 'index.js')
    writeFileSync(entry, 'console.log("adapter")')

    const result = recordAdapterInstall({
      name: 'opencode',
      version: '0.1.0-dev',
      root: dir,
      entry,
      args: [],
      paired: true,
      env,
    })

    expect(result?.record).toMatchObject({
      kind: 'opencode',
      version: '0.1.0-dev',
      path: dir,
      entry: 'index.js',
      node: process.execPath,
    })
    expect(result?.record.pairedAt).toBeTruthy()
    expect(result?.link).toBeUndefined()
    expect(readAdapterRecords(paths(), ['opencode']).adapters.opencode?.entry).toBe('index.js')
  })

  it('links a native binary and removes only its own link', () => {
    const dir = nativeRoot()
    const result = recordAdapterInstall({
      name: 'opencode',
      version: '0.1.0',
      root: dir,
      args: ['--pair', 'code', '--no-runner'],
      paired: true,
      env,
    })
    expect(result?.link?.path).toBe(
      join(
        binDir,
        process.platform === 'win32' ? 'clara-adapter-opencode.cmd' : 'clara-adapter-opencode'
      )
    )
    if (process.platform === 'win32') {
      expect(readFileSync(result!.link!.path, 'utf8')).toContain('Clara command launcher')
    } else {
      expect(lstatSync(result!.link!.path).isSymbolicLink()).toBe(true)
      expect(resolve(readlinkSync(result!.link!.path))).toBe(
        resolve(join(dir, adapterBinaryName('opencode', detectAdapterTarget())))
      )
    }
    expect(result?.record.installArgs).toEqual(['--no-runner'])

    forgetAdapterInstall('opencode', env, dir)
    expect(readAdapterRecords(paths(), ['opencode']).adapters.opencode).toBeUndefined()
    expect(existsSync(result!.link!.path)).toBe(false)
  })

  it('preserves the pairing date and install arguments on reuse', () => {
    const dir = nativeRoot()
    const first = recordAdapterInstall({
      name: 'opencode',
      version: '0.1.0',
      root: dir,
      args: ['--pair', 'code', '--no-runner'],
      paired: true,
      env,
      now: () => new Date('2026-11-16T00:00:00.000Z'),
    })
    const second = recordAdapterInstall({
      name: 'opencode',
      version: '0.2.0',
      root: dir,
      args: ['--reuse-pairing'],
      paired: true,
      env,
      now: () => new Date('2026-11-17T00:00:00.000Z'),
    })
    expect(second?.record.pairedAt).toBe(first?.record.pairedAt)
    expect(second?.record.installedAt).toBe(first?.record.installedAt)
    expect(second?.record.installArgs).toEqual(['--no-runner'])
  })

  it('refreshes the record from a running adapter', () => {
    const dir = nativeRoot()
    recordAdapterInstall({
      name: 'opencode',
      version: '0.1.0',
      root: dir,
      args: ['--pair', 'code', '--no-runner'],
      paired: true,
      env,
    })
    const result = ensureAdapterRecord({
      name: 'opencode',
      version: '0.1.1',
      root: dir,
      paired: true,
      env,
    })
    expect(result?.record.version).toBe('0.1.1')
    expect(result?.record.installArgs).toEqual(['--no-runner'])
    expect(result?.record.pairedAt).toBeTruthy()
  })

  it('does not replace a command Clara did not write', () => {
    const dir = nativeRoot()
    mkdirSync(binDir, { recursive: true })
    const foreign = join(binDir, 'clara-adapter-opencode')
    writeFileSync(foreign, 'someone else')
    const result = recordAdapterInstall({
      name: 'opencode',
      version: '0.1.0',
      root: dir,
      args: [],
      paired: true,
      env,
    })
    expect(result?.link).toBeUndefined()
    expect(result?.warning).toContain('Could not link')
    expect(readFileSync(foreign, 'utf8')).toBe('someone else')
  })
})
