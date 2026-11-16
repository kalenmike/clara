import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { resolvePaths } from '../src/paths.ts'
import { readInstallInfo, versionBinary } from '@clara/release'

const script = fileURLToPath(new URL('../scripts/install.mjs', import.meta.url))
const roots: string[] = []

function tempDir(): string {
  const root = mkdtempSync(join(tmpdir(), 'clara-cli-install-'))
  roots.push(root)
  return root
}

function fakeBuild(root: string): string {
  const directory = join(root, 'build')
  mkdirSync(directory, { recursive: true })
  const binary = join(directory, 'clara')
  writeFileSync(
    binary,
    [
      '#!/bin/sh',
      'if [ "$1" = "--version" ]; then',
      '  printf \'%s (test, build test)\\n\' "${FAKE_CLARA_VERSION:-9.9.9}"',
      '  exit 0',
      'fi',
      'if [ -n "$FAKE_CLARA_LOG" ]; then printf \'%s\\n\' "$*" > "$FAKE_CLARA_LOG"; fi',
      'exit 0',
      '',
    ].join('\n'),
    { mode: 0o755 }
  )
  chmodSync(binary, 0o755)
  return binary
}

function envFor(root: string, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    CLARA_DATA_DIR: join(root, 'data'),
    CLARA_CONFIG_DIR: join(root, 'config'),
    CLARA_CACHE_DIR: join(root, 'cache'),
    CLARA_BIN_DIR: join(root, 'bin'),
    ...extra,
  }
}

function run(args: string[], env: NodeJS.ProcessEnv) {
  return spawnSync(process.execPath, [script, ...args], { env, encoding: 'utf8' })
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe.skipIf(process.platform === 'win32')('cli install script', () => {
  it('stages the build and links it into the bin directory', () => {
    const root = tempDir()
    const binary = fakeBuild(root)
    const env = envFor(root)

    const result = run(['--from', binary], env)
    expect(result.status, result.stderr ?? '').toBe(0)

    const paths = resolvePaths(env)
    const staged = versionBinary(paths, '9.9.9')
    const link = join(env.CLARA_BIN_DIR!, 'clara')
    expect(existsSync(staged)).toBe(true)
    expect(existsSync(link)).toBe(true)
    expect(realpathSync(link)).toBe(staged)

    const info = readInstallInfo(paths)
    expect(info?.version).toBe('9.9.9')
    expect(info?.channel).toBe('local')
    expect(info?.source).toBe(binary)
    expect(info?.previous).toBeUndefined()
  })

  it('keeps the previous version for a rollback', () => {
    const root = tempDir()
    const binary = fakeBuild(root)
    const env = envFor(root)

    expect(run(['--from', binary], { ...env, FAKE_CLARA_VERSION: '9.9.9' }).status).toBe(0)
    expect(run(['--from', binary], { ...env, FAKE_CLARA_VERSION: '9.9.10' }).status).toBe(0)

    const info = readInstallInfo(resolvePaths(env))
    expect(info?.version).toBe('9.9.10')
    expect(info?.previous).toBe('9.9.9')
    expect(existsSync(versionBinary(resolvePaths(env), '9.9.9'))).toBe(true)
  })

  it('prints the plan without writing anything', () => {
    const root = tempDir()
    const binary = fakeBuild(root)
    const env = envFor(root)

    const result = run(['--from', binary, '--dry-run'], env)
    expect(result.status, result.stderr ?? '').toBe(0)
    expect(String(result.stdout)).toContain('Would install:')
    expect(existsSync(join(env.CLARA_DATA_DIR!, 'versions'))).toBe(false)
    expect(existsSync(join(env.CLARA_BIN_DIR!, 'clara'))).toBe(false)
    expect(existsSync(join(env.CLARA_CONFIG_DIR!, 'install.json'))).toBe(false)
  })

  it('fails when the build does not exist', () => {
    const root = tempDir()
    const result = run(['--from', join(root, 'missing')], envFor(root))
    expect(result.status).toBe(1)
    expect(String(result.stderr)).toContain('does not exist')
  })

  it('removes the install through the installed command', () => {
    const root = tempDir()
    const binary = fakeBuild(root)
    const env = envFor(root)
    expect(run(['--from', binary], env).status).toBe(0)

    const log = join(root, 'uninstall.log')
    const result = run(['--uninstall', '--purge'], { ...env, FAKE_CLARA_LOG: log })
    expect(result.status, result.stderr ?? '').toBe(0)
    expect(readFileSync(log, 'utf8').trim()).toBe('uninstall --purge --yes')
  })
})
