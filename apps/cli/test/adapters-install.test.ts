import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ChecksumError } from '../src/adapters/download.ts'
import {
  adapterBinaryPath,
  adapterCommand,
  installAdapter,
  removeAdapter,
  upgradeAdapter,
  type BinaryRunner,
  type ExtractRunner,
  type InstallDeps,
} from '../src/adapters/install.ts'
import { AdapterRegistry } from '../src/adapters/registry.ts'
import { readAdapterState, type AdapterInstallRecord } from '../src/adapters/state.ts'
import { resolvePaths, type ClaraPaths } from '../src/paths.ts'

const SHA = 'a'.repeat(64)

type ServerState = {
  version: string
  archive: Buffer
  archiveFailures: number
  shaOverride?: string
  hits: Map<string, number>
}

type Fixture = {
  base: string
  state: ServerState
  close: () => Promise<void>
}

const fixtures: Fixture[] = []
const roots: string[] = []

async function registryServer(archive = Buffer.from('adapter bytes')): Promise<Fixture> {
  const state: ServerState = { version: '1.2.3', archive, archiveFailures: 0, hits: new Map() }
  let base = ''
  const server = createServer((request, response) => {
    const path = request.url ?? ''
    state.hits.set(path, (state.hits.get(path) ?? 0) + 1)
    if (path === '/opencode/manifest.json') {
      response.setHeader('content-type', 'application/json')
      response.end(
        JSON.stringify({
          schemaVersion: 1,
          harness: 'opencode',
          version: state.version,
          install: 'install.sh',
          installSha256: SHA,
          artifacts: {
            'linux-x64': {
              url: `${base}/opencode/adapter.tar.gz`,
              sha256: state.shaOverride ?? createHash('sha256').update(state.archive).digest('hex'),
              size: state.archive.length,
            },
          },
        })
      )
      return
    }
    if (path === '/opencode/adapter.tar.gz') {
      if (state.archiveFailures > 0) {
        state.archiveFailures -= 1
        response.statusCode = 500
        response.end('transient')
        return
      }
      response.setHeader('content-type', 'application/gzip')
      response.end(state.archive)
      return
    }
    response.statusCode = 404
    response.end('missing')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const fixture: Fixture = {
    base,
    state,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
  fixtures.push(fixture)
  return fixture
}

function tempPaths(): ClaraPaths {
  const root = mkdtempSync(join(tmpdir(), 'clara-adapter-install-'))
  roots.push(root)
  return resolvePaths({
    CLARA_CONFIG_DIR: join(root, 'config'),
    CLARA_DATA_DIR: join(root, 'data'),
    CLARA_CACHE_DIR: join(root, 'cache'),
  })
}

function localAdapterPackage(): string {
  const root = mkdtempSync(join(tmpdir(), 'clara-adapter-local-'))
  roots.push(root)
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ name: '@clara/adapter-opencode', version: '0.1.0' })
  )
  mkdirSync(join(root, 'dist'), { recursive: true })
  writeFileSync(join(root, 'dist', 'index.js'), '#!/usr/bin/env node\n')
  return root
}

type Calls = Array<{ command: string; args: string[] }>

function deps(
  fixture: Fixture,
  paths: ClaraPaths,
  options: {
    calls?: Calls
    result?: (args: readonly string[]) => { code: number; stderr: string }
    extract?: ExtractRunner
    progress?: (received: number, total: number | undefined) => void
  } = {}
): InstallDeps {
  const calls = options.calls ?? []
  const extract: ExtractRunner =
    options.extract ??
    (({ dest }) => {
      writeFileSync(join(dest, 'clara-adapter-opencode'), '#!/bin/sh\nexit 0\n')
    })
  const runBinary: BinaryRunner = async (command, args) => {
    calls.push({ command, args: [...args] })
    if (options.result) return options.result(args)
    if (args.includes('--help')) {
      return { code: 0, stderr: '', stdout: 'Install options:\n  --reuse-pairing\n' }
    }
    return { code: 0, stderr: '' }
  }
  return {
    registry: new AdapterRegistry({ baseUrl: fixture.base }),
    paths,
    now: () => Date.parse('2026-02-03T04:05:06.000Z'),
    runBinary,
    extract,
    ...(options.progress ? { onProgress: options.progress } : {}),
  }
}

afterEach(async () => {
  for (const fixture of fixtures.splice(0)) await fixture.close()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('adapter command', () => {
  it('runs a staged entry with the current Node binary', () => {
    const staged: AdapterInstallRecord = {
      kind: 'opencode',
      version: '0.1.0-dev+local',
      platform: 'linux-x64',
      path: '/data/adapters/opencode/0.1.0-dev+local',
      entry: 'index.js',
      node: '/opt/node/bin/node',
      installedAt: '2026-01-01T00:00:00.000Z',
    }
    expect(adapterCommand(staged)).toEqual({
      command: '/opt/node/bin/node',
      args: [join(staged.path, 'index.js')],
    })
  })
})

describe('adapter install', () => {
  it('downloads, verifies, extracts, records, pairs, and starts', async () => {
    const fixture = await registryServer()
    const paths = tempPaths()
    const calls: Calls = []
    const progress: number[] = []
    const record = await installAdapter(
      { kind: 'opencode', target: 'linux-x64', pairCode: 'clara-pair-abc' },
      deps(fixture, paths, { calls, progress: (received) => progress.push(received) })
    )

    expect(record.version).toBe('1.2.3')
    expect(record.platform).toBe('linux-x64')
    expect(record.path).toBe(join(paths.dataDir, 'adapters', 'opencode', '1.2.3'))
    expect(record.pairedAt).toBe('2026-02-03T04:05:06.000Z')
    expect(record.lastError).toBeUndefined()
    expect(statSync(record.path).mode & 0o777).toBe(0o700)
    expect(existsSync(adapterBinaryPath(record))).toBe(true)
    expect(progress.at(-1)).toBe(fixture.state.archive.length)

    expect(calls).toEqual([
      {
        command: adapterBinaryPath(record),
        args: ['install', '--pair', 'clara-pair-abc'],
      },
      { command: adapterBinaryPath(record), args: ['start'] },
    ])
    expect(readAdapterState(paths).adapters.opencode).toEqual(record)
  })

  it('stages a local build and runs it with Node', async () => {
    const fixture = await registryServer()
    const paths = tempPaths()
    const calls: Calls = []
    const packageDir = mkdtempSync(join(tmpdir(), 'clara-adapter-local-'))
    roots.push(packageDir)
    writeFileSync(
      join(packageDir, 'package.json'),
      JSON.stringify({ name: '@clara/adapter-opencode', version: '0.1.0' })
    )
    const dist = join(packageDir, 'dist')
    mkdirSync(join(dist, 'plugin'), { recursive: true })
    writeFileSync(join(dist, 'index.js'), '#!/usr/bin/env node\n')
    writeFileSync(join(dist, 'plugin', 'index.js'), 'export {}\n')

    const record = await installAdapter(
      {
        kind: 'opencode',
        target: 'linux-x64',
        version: '0.1.0-dev+local',
        pairCode: 'clara-pair-local',
        from: packageDir,
        installArgs: ['--no-runner'],
      },
      deps(fixture, paths, { calls })
    )

    expect(record.entry).toBe('index.js')
    expect(record.version).toBe('0.1.0-dev+local')
    expect(record.path).toBe(join(paths.dataDir, 'adapters', 'opencode', '0.1.0-dev+local'))
    expect(record.installArgs).toEqual(['--no-runner'])
    expect(existsSync(join(record.path, 'plugin', 'index.js'))).toBe(true)
    expect(calls).toEqual([
      {
        command: process.execPath,
        args: [
          join(record.path, 'index.js'),
          'install',
          '--pair',
          'clara-pair-local',
          '--no-runner',
        ],
      },
      { command: process.execPath, args: [join(record.path, 'index.js'), 'start'] },
    ])
  })

  it('rejects a local package for another adapter kind', async () => {
    const fixture = await registryServer()
    const paths = tempPaths()
    const packageDir = mkdtempSync(join(tmpdir(), 'clara-adapter-local-'))
    roots.push(packageDir)
    writeFileSync(
      join(packageDir, 'package.json'),
      JSON.stringify({ name: '@clara/adapter-claude', version: '0.1.0' })
    )
    mkdirSync(join(packageDir, 'dist'), { recursive: true })
    writeFileSync(join(packageDir, 'dist', 'index.js'), '#!/usr/bin/env node\n')

    await expect(
      installAdapter(
        { kind: 'opencode', target: 'linux-x64', from: packageDir },
        deps(fixture, paths)
      )
    ).rejects.toThrow('not @clara/adapter-opencode')
  })

  it('reuses an installed version without downloading it again', async () => {
    const fixture = await registryServer()
    const paths = tempPaths()
    const first = await installAdapter(
      { kind: 'opencode', target: 'linux-x64' },
      deps(fixture, paths)
    )
    const calls: Calls = []
    const second = await installAdapter(
      { kind: 'opencode', target: 'linux-x64', start: false },
      deps(fixture, paths, { calls })
    )

    expect(second.installedAt).toBe(first.installedAt)
    expect(fixture.state.hits.get('/opencode/adapter.tar.gz')).toBe(1)
    expect(calls).toEqual([])
  })

  it('aborts on a checksum mismatch without extracting', async () => {
    const fixture = await registryServer(Buffer.from('different bytes'))
    fixture.state.shaOverride = 'b'.repeat(64)
    const paths = tempPaths()
    let extracted = false
    await expect(
      installAdapter(
        { kind: 'opencode', target: 'linux-x64' },
        deps(fixture, paths, {
          extract: () => {
            extracted = true
          },
        })
      )
    ).rejects.toBeInstanceOf(ChecksumError)
    expect(extracted).toBe(false)
    expect(readAdapterState(paths).adapters.opencode).toBeUndefined()
  })

  it('retries one transient download failure', async () => {
    const fixture = await registryServer()
    fixture.state.archiveFailures = 1
    const paths = tempPaths()
    const record = await installAdapter(
      { kind: 'opencode', target: 'linux-x64', start: false },
      deps(fixture, paths)
    )
    expect(record.version).toBe('1.2.3')
    expect(fixture.state.hits.get('/opencode/adapter.tar.gz')).toBe(2)
  })

  it('captures a pairing failure in the record', async () => {
    const fixture = await registryServer()
    const paths = tempPaths()
    await expect(
      installAdapter(
        { kind: 'opencode', target: 'linux-x64', pairCode: 'bad-code' },
        deps(fixture, paths, {
          result: () => ({ code: 3, stderr: 'the pairing code expired' }),
        })
      )
    ).rejects.toThrow('pairing code expired')
    const saved = readAdapterState(paths).adapters.opencode
    expect(saved?.lastError).toBe('the pairing code expired')
    expect(saved?.pairedAt).toBeUndefined()
  })

  it('can install without starting', async () => {
    const fixture = await registryServer()
    const paths = tempPaths()
    const calls: Calls = []
    await installAdapter(
      { kind: 'opencode', target: 'linux-x64', start: false },
      deps(fixture, paths, { calls })
    )
    expect(calls).toEqual([])
  })

  it('upgrades to the published version when it changes', async () => {
    const fixture = await registryServer()
    const paths = tempPaths()
    await installAdapter({ kind: 'opencode', target: 'linux-x64' }, deps(fixture, paths))

    fixture.state.version = '2.0.0'
    const report = await upgradeAdapter('opencode', deps(fixture, paths), {
      target: 'linux-x64',
      start: false,
    })
    expect(report).toEqual({ kind: 'opencode', from: '1.2.3', to: '2.0.0', changed: true })
    expect(readAdapterState(paths).adapters.opencode?.version).toBe('2.0.0')
  })

  it('reinstalls at the same version without a new pairing', async () => {
    const fixture = await registryServer()
    const paths = tempPaths()
    await installAdapter({ kind: 'opencode', target: 'linux-x64' }, deps(fixture, paths))
    const calls: Calls = []
    const report = await upgradeAdapter('opencode', deps(fixture, paths, { calls }))
    expect(report).toEqual({
      kind: 'opencode',
      from: '1.2.3',
      to: '1.2.3',
      changed: false,
      reinstalled: true,
    })
    expect(calls.map((call) => call.args)).toEqual([
      ['stop'],
      ['install', '--help'],
      ['install', '--reuse-pairing'],
      ['start'],
    ])
  })

  it('reinstalls a local build with the saved pairing', async () => {
    const fixture = await registryServer()
    const paths = tempPaths()
    const packageDir = mkdtempSync(join(tmpdir(), 'clara-adapter-local-'))
    roots.push(packageDir)
    writeFileSync(
      join(packageDir, 'package.json'),
      JSON.stringify({ name: '@clara/adapter-opencode', version: '0.1.0' })
    )
    mkdirSync(join(packageDir, 'dist'), { recursive: true })
    writeFileSync(join(packageDir, 'dist', 'index.js'), '#!/usr/bin/env node\n')

    const calls: Calls = []
    const record = await installAdapter(
      {
        kind: 'opencode',
        target: 'linux-x64',
        version: '0.1.0-dev+local',
        from: packageDir,
        reusePairing: true,
        start: false,
      },
      deps(fixture, paths, { calls })
    )

    expect(record.entry).toBe('index.js')
    expect(calls).toEqual([
      {
        command: process.execPath,
        args: [join(record.path, 'index.js'), 'install', '--help'],
      },
      {
        command: process.execPath,
        args: [join(record.path, 'index.js'), 'install', '--reuse-pairing'],
      },
    ])
  })

  it('refuses to reuse a saved pairing an older adapter does not understand', async () => {
    const fixture = await registryServer()
    const paths = tempPaths()
    const packageDir = localAdapterPackage()
    const calls: Calls = []

    await expect(
      installAdapter(
        {
          kind: 'opencode',
          target: 'linux-x64',
          version: '0.1.0-dev+old',
          from: packageDir,
          reusePairing: true,
          start: false,
        },
        deps(fixture, paths, {
          calls,
          result: (args) =>
            args.includes('--help')
              ? { code: 0, stderr: '', stdout: 'Install options:\n  --pair <code>\n' }
              : { code: 0, stderr: '' },
        })
      )
    ).rejects.toThrow(/cannot reinstall from its saved pairing/)

    expect(calls.map((call) => call.args.slice(-2))).toEqual([['install', '--help']])
    expect(readAdapterState(paths).adapters.opencode).toBeUndefined()
  })

  it('proceeds when the reuse probe cannot run', async () => {
    const fixture = await registryServer()
    const paths = tempPaths()
    const packageDir = localAdapterPackage()
    const calls: Calls = []

    const record = await installAdapter(
      {
        kind: 'opencode',
        target: 'linux-x64',
        version: '0.1.0-dev+local',
        from: packageDir,
        reusePairing: true,
        start: false,
      },
      deps(fixture, paths, {
        calls,
        result: (args) =>
          args.includes('--help') ? { code: 2, stderr: 'probe failed' } : { code: 0, stderr: '' },
      })
    )

    expect(record.entry).toBe('index.js')
    expect(calls.at(-1)?.args).toEqual([
      join(record.path, 'index.js'),
      'install',
      '--reuse-pairing',
    ])
  })

  it('stops and uninstalls an adapter before deleting its files', async () => {
    const fixture = await registryServer()
    const paths = tempPaths()
    const record = await installAdapter(
      { kind: 'opencode', target: 'linux-x64' },
      deps(fixture, paths)
    )
    const calls: Calls = []
    const actions = await removeAdapter('opencode', deps(fixture, paths, { calls }), {
      purge: true,
    })

    expect(calls.map((call) => call.args)).toEqual([['stop'], ['uninstall', '--purge']])
    expect(actions).toContain(`remove ${record.path}`)
    expect(readAdapterState(paths).adapters.opencode).toBeUndefined()
    expect(existsSync(join(paths.dataDir, 'adapters', 'opencode'))).toBe(false)
  })
})

describe('adapter state guard', () => {
  it('refuses to upgrade or remove an adapter that is not installed', async () => {
    const fixture = await registryServer()
    const paths = tempPaths()
    await expect(upgradeAdapter('pi', deps(fixture, paths))).rejects.toThrow('not installed')
    await expect(removeAdapter('pi', deps(fixture, paths))).rejects.toThrow('not installed')
  })
})
