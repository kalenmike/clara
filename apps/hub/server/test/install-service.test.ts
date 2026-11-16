import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import type { ServerConfig } from '../src/config.ts'
import { InstallRegistry } from '../src/panel/install-registry.ts'
import { InstallService } from '../src/panel/install-service.ts'

const SHA = 'a'.repeat(64)

function config(relay = true): ServerConfig {
  return {
    local: { host: '127.0.0.1', bindHost: '127.0.0.1', port: 8788 },
    ...(relay
      ? {
          relay: {
            url: 'wss://relay.example',
            room: 'room',
            agentToken: 'a'.repeat(32),
          },
        }
      : {}),
    pairingBaseUrl: 'https://clara.example',
    adapterRegistryUrl: 'https://clara.example/adapters',
    configDir: join(tmpdir(), 'clara-install'),
    configPath: join(tmpdir(), 'clara-install', 'server.json'),
    dataDir: join(tmpdir(), 'clara-install'),
    dbPath: join(tmpdir(), 'clara-install', 'clara.db'),
    sources: {
      localHost: 'default',
      localBindHost: 'default',
      localPort: 'default',
      relayUrl: relay ? 'file' : 'none',
      relayRoom: relay ? 'file' : 'none',
      agentToken: relay ? 'file' : 'none',
      pairingBaseUrl: 'default',
      adapterRegistryUrl: 'file',
    },
  }
}

const manifest = {
  schemaVersion: 1,
  harness: 'opencode',
  version: '0.1.0-dev+abc1234',
  install: 'install.sh',
  installSha256: SHA,
  artifacts: {
    'linux-x64': {
      url: 'https://github.com/example/clara/releases/download/v0.1.0-dev+abc1234/adapter.tar.gz',
      sha256: SHA,
    },
  },
}

function registry(): InstallRegistry {
  const fetchImpl = (async () =>
    new Response(JSON.stringify(manifest), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch
  return new InstallRegistry({ config: config(), fetchImpl, kinds: ['opencode'] })
}

function service(
  overrides: Partial<ConstructorParameters<typeof InstallService>[0]> = {}
): InstallService {
  return new InstallService({
    config: config(),
    registry: registry(),
    isEnabled: () => true,
    log: () => {},
    ...overrides,
  })
}

describe('install service', () => {
  it('reports availability and registry entries', async () => {
    const available = await service().info()
    expect(available.available).toBe(true)
    expect(available.registry.entries[0]?.ok).toBe(true)

    const disabled = await service({ isEnabled: () => false }).info()
    expect(disabled.available).toBe(false)
    expect(disabled.reason).toMatch(/Adapter setup is off/)
    expect(disabled.registry.entries[0]?.ok).toBe(true)
  })

  it('resolves a manifest and builds the one-line command', async () => {
    const install = service()
    const resolved = await install.manifest('opencode')
    expect(resolved.manifest.version).toBe(manifest.version)
    expect(install.command(resolved.manifest, 'clara-harness1_code')).toBe(
      "curl -fsSL https://clara.example/adapters/opencode/install.sh | CLARA_ADAPTER_REGISTRY_URL='https://clara.example/adapters' sh -s -- --pair clara-harness1_code --no-runner"
    )
    expect(install.command(resolved.manifest, 'clara-harness1_code', 'http://127.0.0.1:4096')).toBe(
      "curl -fsSL https://clara.example/adapters/opencode/install.sh | CLARA_ADAPTER_REGISTRY_URL='https://clara.example/adapters' sh -s -- --pair clara-harness1_code --no-runner '--opencode-url' 'http://127.0.0.1:4096'"
    )
    expect(install.deepLink('clara-harness1_code')).toBe('clara://adapter?code=clara-harness1_code')
  })

  it('reports the installed adapter version next to the registry version', async () => {
    const info = await service({
      installedVersion: (kind) => (kind === 'opencode' ? '0.0.9' : undefined),
    }).info()
    expect(info.registry.entries[0]?.installedVersion).toBe('0.0.9')
    expect(info.registry.entries[0]?.manifest?.version).toBe(manifest.version)

    const offline = await service({ installedVersion: () => undefined }).info()
    expect(offline.registry.entries[0]?.installedVersion).toBeUndefined()
  })

  it('does not hand out manifests while the setting is off', async () => {
    await expect(service({ isEnabled: () => false }).manifest('opencode')).rejects.toThrow(
      /Adapter setup is off/
    )
  })
})
