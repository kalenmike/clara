import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { extractEmbeddedAssets } from '../src/assets/bootstrap.ts'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'clara-assets-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function source(name: string, contents: string): string {
  const path = join(dir, name)
  writeFileSync(path, contents)
  return path
}

describe('embedded assets', () => {
  it('extracts below the cache build id and points the services at it', () => {
    const env = { CLARA_CACHE_DIR: join(dir, 'cache') } as NodeJS.ProcessEnv
    const root = extractEmbeddedAssets(
      {
        buildId: 'abc123',
        assets: { 'panel/index.html': source('panel.html', '<!doctype html>') },
      },
      env
    )

    expect(root).toBe(join(dir, 'cache', 'assets', 'abc123'))
    expect(readFileSync(join(root, 'panel', 'index.html'), 'utf8')).toBe('<!doctype html>')
    expect(existsSync(join(root, '.complete'))).toBe(true)
    expect(env.CLARA_PANEL_ASSETS_DIR).toBe(join(root, 'panel'))
    expect(env.CLARA_WEB_ASSETS_DIR).toBe(join(root, 'web'))
    expect(env.CLARA_ENGINE_ASSETS_DIR).toBe(join(root, 'engine'))
  })

  it('keeps an existing extraction for the same build', () => {
    const env = { CLARA_CACHE_DIR: join(dir, 'cache') } as NodeJS.ProcessEnv
    const manifest = { buildId: 'abc123', assets: { 'panel/app.css': source('app.css', 'one') } }

    const root = extractEmbeddedAssets(manifest, env)
    writeFileSync(join(root, 'panel', 'app.css'), 'changed')
    extractEmbeddedAssets(manifest, env)

    expect(readFileSync(join(root, 'panel', 'app.css'), 'utf8')).toBe('changed')
  })

  it.skipIf(process.platform === 'win32')(
    'writes extracted files with owner-only permissions',
    () => {
      const env = { CLARA_CACHE_DIR: join(dir, 'cache') } as NodeJS.ProcessEnv
      const root = extractEmbeddedAssets(
        {
          buildId: 'abc123',
          assets: { 'web/index.html': source('index.html', '<!doctype html>') },
        },
        env
      )

      expect(statSync(join(root, 'web', 'index.html')).mode & 0o777).toBe(0o600)
    }
  )

  it('refuses absolute and traversing asset names', () => {
    const env = { CLARA_CACHE_DIR: join(dir, 'cache') } as NodeJS.ProcessEnv
    const asset = source('index.html', '<!doctype html>')

    expect(() =>
      extractEmbeddedAssets({ buildId: 'abc123', assets: { '../escape.html': asset } }, env)
    ).toThrow(/unsafe embedded asset path/)
    expect(() =>
      extractEmbeddedAssets({ buildId: 'abc123', assets: { '/absolute.html': asset } }, env)
    ).toThrow(/unsafe embedded asset path/)
  })
})
