import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { fetchEngineAssets, readCachedAsset } from '../src/assets.ts'

const servers: Server[] = []
const dirs: string[] = []
const previous = process.env.CLARA_CACHE_DIR

afterEach(async () => {
  for (const server of servers.splice(0)) {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  if (previous === undefined) delete process.env.CLARA_CACHE_DIR
  else process.env.CLARA_CACHE_DIR = previous
})

function cacheDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'clara-lab-assets-'))
  dirs.push(dir)
  process.env.CLARA_CACHE_DIR = dir
  return dir
}

async function engine(
  files: Record<string, string>,
  hash = 'abcdef1234567890'
): Promise<{ url: string; hits: () => number }> {
  let hits = 0
  const server = createServer((request, response) => {
    hits += 1
    if (request.url !== '/v1/packages/assets') {
      response.writeHead(404)
      response.end()
      return
    }
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({ version: '0.1.0', hash, files }))
  })
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  return { url: `http://127.0.0.1:${port}`, hits: () => hits }
}

describe('engine std assets', () => {
  it('materializes the engine bundle and reuses the hash cache', async () => {
    cacheDir()
    const source = await engine({
      'std/software/index.yml': 'id: std:software\n',
      'default/index.yml': 'defaults: {}\n',
    })

    const first = await fetchEngineAssets({ url: source.url, token: 'token' })
    expect(first?.hash).toBe('abcdef1234567890')
    expect(first && readCachedAsset(first, 'std/software/index.yml')).toContain('std:software')
    expect(first && readCachedAsset(first, 'default/index.yml')).toContain('defaults')

    const second = await fetchEngineAssets({ url: source.url, token: 'token' })
    expect(second?.dir).toBe(first?.dir)
    // The second call still asks the engine for the current hash, but it does
    // not rewrite the cached bundle.
    expect(source.hits()).toBe(2)
  })

  it('skips unsafe file names and requires the default config', async () => {
    cacheDir()
    const source = await engine({
      '../evil.yml': 'nope',
      '/absolute.yml': 'nope',
      'std/software/index.yml': 'id: std:software\n',
    })
    expect(await fetchEngineAssets({ url: source.url, token: 'token' })).toBeUndefined()
  })

  it('does nothing without an engine token', async () => {
    cacheDir()
    const source = await engine({ 'default/index.yml': 'defaults: {}\n' })
    expect(await fetchEngineAssets({ url: source.url, token: '' })).toBeUndefined()
    expect(source.hits()).toBe(0)
  })
})
