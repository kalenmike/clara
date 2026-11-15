import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  AdapterRegistry,
  DEFAULT_ADAPTER_REGISTRY_URL,
  resolveRegistryUrl,
  validateAdapterManifest,
} from '../src/adapters/registry.ts'

const SHA = 'a'.repeat(64)

type Result = { status?: number; body?: unknown }
type Fixture = {
  base: string
  close: () => Promise<void>
  hits: Map<string, number>
}

async function fixture(routes: Record<string, (base: string) => Result>): Promise<Fixture> {
  const hits = new Map<string, number>()
  let base = ''
  const server = createServer((request, response) => {
    const path = request.url ?? ''
    hits.set(path, (hits.get(path) ?? 0) + 1)
    const route = routes[path]
    if (!route) {
      response.statusCode = 404
      response.end('missing')
      return
    }
    const result = route(base)
    response.statusCode = result.status ?? 200
    response.setHeader('content-type', 'application/json')
    response.end(typeof result.body === 'string' ? result.body : JSON.stringify(result.body))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  return {
    base,
    hits,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}

function manifest(
  base: string,
  kind: string,
  version = '1.2.3',
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    schemaVersion: 1,
    harness: kind,
    version,
    install: 'install.sh',
    installSha256: SHA,
    artifacts: {
      'linux-x64': { url: `${base}/${kind}/adapter.tar.gz`, sha256: SHA, size: 1_234 },
      'linux-arm64': { url: `${base}/${kind}/adapter-arm.tar.gz`, sha256: SHA, size: 2_000 },
    },
    ...overrides,
  }
}

const servers: Fixture[] = []

afterEach(async () => {
  for (const server of servers.splice(0)) await server.close()
})

describe('adapter registry', () => {
  it('lists every kind and keeps one broken manifest from failing the rest', async () => {
    const server = await fixture({
      '/opencode/manifest.json': (base) => ({ body: manifest(base, 'opencode') }),
      '/claude/manifest.json': () => ({ status: 404, body: { error: 'missing' } }),
      '/pi/manifest.json': (base) => ({
        body: manifest(base, 'pi', '0.9.0', { harness: 'not-pi' }),
      }),
    })
    servers.push(server)
    const registry = new AdapterRegistry({ baseUrl: server.base })

    const report = await registry.search('linux-x64')
    expect(report.entries.map((entry) => entry.kind)).toEqual(['opencode', 'claude', 'pi'])
    expect(report.entries.map((entry) => entry.ok)).toEqual([true, false, false])
    expect(report.entries[0]?.version).toBe('1.2.3')
    expect(report.entries[0]?.size).toBe(1_234)
    expect(report.entries[0]?.target).toBe('linux-x64')
    expect(report.entries[0]?.platforms).toEqual(['linux-arm64', 'linux-x64'])
    expect(report.entries[1]?.error).toContain('404')
    expect(report.entries[2]?.error).toContain('not-pi')
  })

  it('omits the platform size when the caller does not ask for a target', async () => {
    const server = await fixture({
      '/opencode/manifest.json': (base) => ({ body: manifest(base, 'opencode') }),
    })
    servers.push(server)
    const registry = new AdapterRegistry({ baseUrl: server.base })

    const report = await registry.search()
    expect(report.target).toBeUndefined()
    expect(report.entries[0]?.size).toBeUndefined()
  })

  it('caches manifests briefly', async () => {
    const server = await fixture({
      '/opencode/manifest.json': (base) => ({ body: manifest(base, 'opencode') }),
    })
    servers.push(server)
    const registry = new AdapterRegistry({ baseUrl: server.base, cacheMs: 60_000 })

    await registry.manifest('opencode')
    await registry.manifest('opencode')
    expect(server.hits.get('/opencode/manifest.json')).toBe(1)
  })

  it('fetches again after the cache expires', async () => {
    const server = await fixture({
      '/opencode/manifest.json': (base) => ({ body: manifest(base, 'opencode') }),
    })
    servers.push(server)
    let now = 0
    const registry = new AdapterRegistry({
      baseUrl: server.base,
      cacheMs: 1_000,
      errorCacheMs: 1_000,
      now: () => now,
    })

    await registry.manifest('opencode')
    now += 2_000
    await registry.manifest('opencode')
    expect(server.hits.get('/opencode/manifest.json')).toBe(2)
  })

  it('rejects non-HTTPS artifact URLs', () => {
    const base = 'https://clara.test/adapters'
    const value = manifest(base, 'opencode', '1.0.0', {
      artifacts: {
        'linux-x64': { url: 'http://example.com/a.tar.gz', sha256: SHA, size: 1 },
      },
    })
    expect(() =>
      validateAdapterManifest('opencode', value, `${base}/opencode/manifest.json`)
    ).toThrow('must use HTTPS')
  })

  it('rejects a bad schema, harness, and digest', () => {
    const base = 'https://clara.test/adapters'
    const url = `${base}/opencode/manifest.json`
    expect(() =>
      validateAdapterManifest(
        'opencode',
        manifest(base, 'opencode', '1.0.0', { schemaVersion: 2 }),
        url
      )
    ).toThrow('schema')
    expect(() => validateAdapterManifest('opencode', manifest(base, 'claude'), url)).toThrow(
      'not opencode'
    )
    expect(() =>
      validateAdapterManifest(
        'opencode',
        manifest(base, 'opencode', '1.0.0', { installSha256: 'nope' }),
        url
      )
    ).toThrow('SHA-256')
  })
})

describe('registry URL resolution', () => {
  const original = process.env.CLARA_ADAPTER_REGISTRY_URL

  afterEach(() => {
    if (original === undefined) delete process.env.CLARA_ADAPTER_REGISTRY_URL
    else process.env.CLARA_ADAPTER_REGISTRY_URL = original
  })

  it('prefers the environment, then server.json, then the default', () => {
    const dir = mkdtempSync(join(tmpdir(), 'clara-registry-url-'))
    try {
      expect(
        resolveRegistryUrl({
          CLARA_CONFIG_DIR: dir,
          CLARA_ADAPTER_REGISTRY_URL: 'https://env.test/adapters/',
        })
      ).toBe('https://env.test/adapters')

      writeFileSync(
        join(dir, 'server.json'),
        JSON.stringify({ adapterRegistryUrl: 'https://file.test/adapters' })
      )
      expect(resolveRegistryUrl({ CLARA_CONFIG_DIR: dir })).toBe('https://file.test/adapters')
      expect(resolveRegistryUrl({ CLARA_CONFIG_DIR: join(dir, 'missing') })).toBe(
        DEFAULT_ADAPTER_REGISTRY_URL
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
