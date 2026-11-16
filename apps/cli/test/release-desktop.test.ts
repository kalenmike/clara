import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  DesktopUnavailableError,
  desktopArtifact,
  desktopPlatformKey,
  desktopStatus,
  installDesktop,
  readDesktopInstallInfo,
  uninstallDesktop,
} from '../src/release/desktop.ts'
import { parseManifest, type ReleaseManifest } from '@clara/release'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'clara-desktop-'))
})

afterEach(() => rmSync(root, { recursive: true, force: true }))

function manifest(bytes: Buffer, overrides: Record<string, unknown> = {}): ReleaseManifest {
  return parseManifest(
    Buffer.from(
      JSON.stringify({
        schemaVersion: 2,
        channel: 'stable',
        generatedAt: new Date().toISOString(),
        cli: {
          version: '0.2.0',
          publishedAt: '2026-11-15T00:00:00.000Z',
          artifacts: {
            'linux-x64': {
              url: 'https://example.test/clara-linux-x64.tar.gz',
              sha256: 'a'.repeat(64),
              size: 10,
            },
          },
        },
        desktop: {
          version: '0.2.0',
          tag: 'desktop-v0.2.0',
          publishedAt: '2026-11-15T00:00:00.000Z',
          artifacts: {
            'linux-x64': {
              url: 'https://example.test/Clara.AppImage',
              sha256: createHash('sha256').update(bytes).digest('hex'),
              size: bytes.length,
              type: 'appimage',
            },
          },
        },
        ...overrides,
      })
    )
  )
}

describe('desktop release', () => {
  it('maps host platforms and excludes musl', () => {
    expect(desktopPlatformKey({ platform: 'linux', arch: 'x64', isMusl: () => false })).toBe(
      'linux-x64'
    )
    expect(
      desktopPlatformKey({ platform: 'linux', arch: 'x64', isMusl: () => true })
    ).toBeUndefined()
    expect(desktopPlatformKey({ platform: 'darwin', arch: 'arm64' })).toBe('darwin-arm64')
  })

  it('reports a missing desktop build', () => {
    const value = manifest(Buffer.from('appimage'), { desktop: undefined })
    expect(() => desktopArtifact(value, 'linux-x64')).toThrow(DesktopUnavailableError)
  })

  it('installs and removes the Linux AppImage integration', async () => {
    const bytes = Buffer.from('appimage-bytes')
    const value = manifest(bytes)
    const home = join(root, 'home')
    const dataDir = join(root, 'data')
    const configDir = join(root, 'config')
    const binDir = join(root, 'bin')
    mkdirSync(home, { recursive: true })

    const info = await installDesktop({
      manifest: value,
      cacheDir: join(root, 'cache'),
      dataDir,
      configDir,
      binDir,
      homeDir: home,
      platform: 'linux-x64',
      fetchImpl: (async () =>
        new Response(bytes, {
          status: 200,
          headers: { 'content-length': String(bytes.length) },
        })) as typeof fetch,
      run: () => ({ status: 0, stdout: '', stderr: '' }),
    })

    expect(info.version).toBe('0.2.0')
    expect(existsSync(join(binDir, 'clara-desktop'))).toBe(true)
    expect(existsSync(join(home, '.local', 'share', 'applications', 'clara.desktop'))).toBe(true)
    expect(
      readFileSync(join(home, '.local', 'share', 'applications', 'clara.desktop'), 'utf8')
    ).toContain('Exec=')
    expect(desktopStatus(configDir)).toMatchObject({ installed: true, version: '0.2.0' })

    expect(
      uninstallDesktop({
        configDir,
        dataDir,
        binDir,
        homeDir: home,
        run: () => ({ status: 0, stdout: '', stderr: '' }),
      })
    ).toBe(true)
    expect(existsSync(join(binDir, 'clara-desktop'))).toBe(false)
    expect(readDesktopInstallInfo(configDir)).toBeUndefined()
  })
})
