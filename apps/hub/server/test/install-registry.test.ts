import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import type { ServerConfig } from '../src/config.ts'
import { InstallRegistry, validateManifest } from '../src/panel/install-registry.ts'

const SHA = 'a'.repeat(64)

function config(overrides: Partial<ServerConfig> = {}): ServerConfig {
  return {
    local: { host: '127.0.0.1', bindHost: '127.0.0.1', port: 8788 },
    pairingBaseUrl: 'https://clara.example',
    adapterRegistryUrl: 'https://clara.example/adapters',
    configDir: join(tmpdir(), 'clara-registry'),
    configPath: join(tmpdir(), 'clara-registry', 'server.json'),
    dataDir: join(tmpdir(), 'clara-registry'),
    dbPath: join(tmpdir(), 'clara-registry', 'clara.db'),
    sources: {
      localHost: 'default',
      localBindHost: 'default',
      localPort: 'default',
      relayUrl: 'none',
      relayRoom: 'none',
      agentToken: 'none',
      pairingBaseUrl: 'default',
      adapterRegistryUrl: 'file',
    },
    ...overrides,
  }
}

function manifest(kind: string, version = '0.1.0-dev+abc1234') {
  return {
    schemaVersion: 1,
    harness: kind,
    version,
    install: 'install.sh',
    installSha256: SHA,
    artifacts: {
      'linux-x64': {
        url: `https://github.com/example/clara/releases/download/v${version}/adapter-${kind}-linux-x64.tar.gz`,
        sha256: SHA,
        size: 1_024,
      },
    },
  }
}

function fetchFor(versions: Record<string, string> = {}): {
  fetchImpl: typeof fetch
  calls: string[]
} {
  const calls: string[] = []
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input)
    calls.push(url)
    const kind = url.includes('/opencode/') ? 'opencode' : 'claude'
    const body = manifest(kind, versions[kind] ?? '0.1.0-dev+abc1234')
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof fetch
  return { fetchImpl, calls }
}

describe('adapter registry manifests', () => {
  it('resolves relative install and artifact URLs', () => {
    const parsed = validateManifest(
      'opencode',
      manifest('opencode'),
      'https://clara.example/adapters/opencode/manifest.json'
    )
    expect(parsed.install).toBe('https://clara.example/adapters/opencode/install.sh')
    expect(parsed.artifacts['linux-x64']?.url).toBe(
      'https://github.com/example/clara/releases/download/v0.1.0-dev+abc1234/adapter-opencode-linux-x64.tar.gz'
    )
    expect(parsed.installSha256).toBe(SHA)
  })

  it('rejects a manifest for another harness or an insecure artifact', () => {
    expect(() =>
      validateManifest('opencode', manifest('claude'), 'https://clara.example/manifest.json')
    ).toThrow('not opencode')
    expect(() =>
      validateManifest(
        'opencode',
        {
          ...manifest('opencode'),
          artifacts: { 'linux-x64': { url: 'http://example.com/a.tar.gz', sha256: SHA } },
        },
        'https://clara.example/manifest.json'
      )
    ).toThrow('must use HTTPS')
    expect(() =>
      validateManifest(
        'opencode',
        { ...manifest('opencode'), installSha256: 'nope' },
        'https://clara.example/manifest.json'
      )
    ).toThrow('SHA-256')
  })

  it('reads and caches both manifests', async () => {
    const { fetchImpl, calls } = fetchFor()
    const registry = new InstallRegistry({
      config: config(),
      fetchImpl,
      kinds: ['opencode', 'claude'],
    })

    const first = await registry.info()
    expect(first.entries.map((entry) => entry.ok)).toEqual([true, true])
    expect(first.entries[0]?.manifest?.version).toBe('0.1.0-dev+abc1234')
    expect(calls).toHaveLength(2)

    await registry.info()
    expect(calls).toHaveLength(2)

    await registry.info(true)
    expect(calls).toHaveLength(4)
  })

  it('returns an error entry when a manifest is missing', async () => {
    const fetchImpl = (async () => new Response('missing', { status: 404 })) as typeof fetch
    const registry = new InstallRegistry({
      config: config(),
      fetchImpl,
      kinds: ['opencode'],
    })
    const info = await registry.info()
    expect(info.entries[0]?.ok).toBe(false)
    expect(info.entries[0]?.error).toContain('404')
    await expect(registry.resolved('opencode')).rejects.toThrow('404')
  })

  it('resolves the install URL for a valid manifest', async () => {
    const { fetchImpl } = fetchFor()
    const registry = new InstallRegistry({
      config: config(),
      fetchImpl,
      kinds: ['opencode'],
    })
    const resolved = await registry.resolved('opencode')
    expect(resolved.installUrl).toBe('https://clara.example/adapters/opencode/install.sh')
    expect(resolved.manifest.version).toBe('0.1.0-dev+abc1234')
  })
})
