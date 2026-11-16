import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  compareVersions,
  isAdapterVersion,
  readAdapterProvenance,
  resolveAdapterVersion,
  sanitizeInstallArgs,
  writeAdapterProvenance,
} from '../src/index.ts'

const roots: string[] = []

function tempDir(): string {
  const root = mkdtempSync(join(tmpdir(), 'clara-adapter-provenance-'))
  roots.push(root)
  return root
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('adapter versions', () => {
  it('orders releases and prereleases', () => {
    expect(compareVersions('0.2.0', '0.1.9')).toBeGreaterThan(0)
    expect(compareVersions('0.2.0', '0.2.0')).toBe(0)
    expect(compareVersions('0.2.0-beta.1', '0.2.0')).toBeLessThan(0)
    expect(compareVersions('0.2.0-beta.2', '0.2.0-beta.1')).toBeGreaterThan(0)
    expect(compareVersions('0.2.0-beta.10', '0.2.0-beta.9')).toBeGreaterThan(0)
  })

  it('accepts release-shaped versions', () => {
    expect(isAdapterVersion('0.1.0')).toBe(true)
    expect(isAdapterVersion('0.1.0-dev+abc1234')).toBe(true)
    expect(isAdapterVersion('latest')).toBe(false)
  })
})

describe('adapter install provenance', () => {
  it('round-trips a registry install', () => {
    const root = tempDir()
    writeAdapterProvenance(root, {
      schemaVersion: 1,
      kind: 'opencode',
      version: '0.2.0',
      platform: 'linux-x64',
      source: 'registry',
      registryUrl: 'https://example.test/adapters',
      artifactUrl: 'https://example.test/opencode.tar.gz',
      artifactSha256: 'a'.repeat(64),
      installArgs: ['--no-runner'],
      installedAt: new Date().toISOString(),
    })
    expect(readAdapterProvenance(root)).toMatchObject({
      kind: 'opencode',
      version: '0.2.0',
      source: 'registry',
      registryUrl: 'https://example.test/adapters',
      installArgs: ['--no-runner'],
    })
  })

  it('requires a registry for registry installs and ignores malformed records', () => {
    const root = tempDir()
    writeAdapterProvenance(root, {
      schemaVersion: 1,
      kind: 'opencode',
      version: '0.2.0',
      platform: 'linux-x64',
      source: 'registry',
      installedAt: new Date().toISOString(),
    })
    expect(readAdapterProvenance(root)).toBeUndefined()
  })

  it('falls back to the version directory while install.json is missing', () => {
    const root = join(tempDir(), '0.3.0')
    expect(resolveAdapterVersion(root, '0.1.0')).toBe('0.3.0')
    expect(resolveAdapterVersion(undefined, '0.1.0')).toBe('0.1.0')
  })

  it('drops pairing and secret flags before recording install arguments', () => {
    expect(
      sanitizeInstallArgs([
        '--pair',
        'clara-harness1_abc',
        '--reuse-pairing',
        '--no-runner',
        '--opencode-url=http://127.0.0.1:4096',
        '--opencode-password',
        'secret',
        '--token=x',
        '--version',
        '0.2.0',
        '--registry',
        'https://example.test',
      ])
    ).toEqual(['--no-runner', '--opencode-url=http://127.0.0.1:4096'])
  })
})
