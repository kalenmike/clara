import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import type {
  PanelHarnessPairing,
  PanelInstallDockerTargets,
  PanelInstallSshTargets,
} from '@clara/shared-types'
import type { ServerConfig } from '../src/config.ts'
import { InstallRegistry } from '../src/panel/install-registry.ts'
import {
  InstallService,
  type InstallRunner,
  type InstallRunResult,
} from '../src/panel/install-service.ts'

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

const pairing: PanelHarnessPairing = {
  id: 'pair-1',
  kind: 'opencode',
  label: 'OpenCode',
  code: 'clara-harness1_code',
  transport: 'relay',
  wsUrl: 'wss://relay.example/room/room',
  room: 'room',
  fingerprint: SHA,
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
  createdAt: new Date().toISOString(),
}

const sshTargets: () => Promise<PanelInstallSshTargets> = async () => ({
  available: true,
  hosts: [{ alias: 'prod', hostname: 'prod.example', user: 'ubuntu', port: 2222 }],
})

const dockerTargets: () => Promise<PanelInstallDockerTargets> = async () => ({
  available: true,
  containers: [{ id: 'abcdef012345', name: 'harness', image: 'opencode', state: 'running' }],
})

function service(
  overrides: Partial<ConstructorParameters<typeof InstallService>[0]> = {}
): InstallService {
  return new InstallService({
    config: config(),
    registry: registry(),
    isEnabled: () => true,
    isContainerized: () => false,
    allowRemote: () => false,
    log: () => {},
    sshTargets,
    dockerTargets,
    runner: async () => ({ exitCode: 0 }),
    ...overrides,
  })
}

async function tick(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('install service', () => {
  it('derives the pairing transport', () => {
    expect(service().transportFor('ssh')).toBe('relay')
    expect(service().transportFor('docker')).toBe('relay')
    expect(() => service({ config: config(false) }).transportFor('ssh')).toThrow(
      /Configure the relay/
    )
    expect(() => service({ isContainerized: () => true }).transportFor('docker')).toThrow(
      /runs in Docker/
    )
    expect(() => service({ isEnabled: () => false }).transportFor('ssh')).toThrow(
      /Adapter installs are off/
    )
  })

  it('rejects installs while the setting is off', async () => {
    const install = service({ isEnabled: () => false })
    await expect(
      install.start({ kind: 'opencode', method: 'ssh', host: { alias: 'prod' }, pairing })
    ).rejects.toThrow(/Adapter installs are off/)
  })

  it('runs an SSH install and records its output', async () => {
    let finish: ((result: InstallRunResult) => void) | undefined
    const runner: InstallRunner = async (_command, _args, onLine) => {
      onLine('downloading adapter')
      return new Promise((resolve) => {
        finish = resolve
      })
    }
    const install = service({ runner })
    const job = await install.start({
      kind: 'opencode',
      method: 'ssh',
      host: { alias: 'prod' },
      pairing,
    })
    expect(job.state).toBe('running')
    expect(job.lines.join('\n')).toContain('Installing opencode')

    finish?.({ exitCode: 0 })
    await tick()
    const done = install.job(job.id)
    expect(done?.state).toBe('succeeded')
    expect(done?.lines).toContain('downloading adapter')
    expect(done?.lines.join('\n')).toContain('Waiting for it to connect')
  })

  it('runs a Docker install and rejects an unknown container', async () => {
    const install = service()
    const job = await install.start({
      kind: 'opencode',
      method: 'docker',
      container: 'harness',
      pairing,
    })
    expect(job.target).toBe('harness')

    await expect(
      install.start({ kind: 'opencode', method: 'docker', container: 'other', pairing })
    ).rejects.toThrow(/not running/)
  })

  it('cancels a running install', async () => {
    const runner: InstallRunner = (_command, _args, _onLine, signal) =>
      new Promise((resolve) => {
        signal.addEventListener('abort', () => resolve({ exitCode: null, signal: 'SIGTERM' }))
      })
    const install = service({ runner })
    const job = await install.start({
      kind: 'opencode',
      method: 'ssh',
      host: { alias: 'prod' },
      pairing,
    })
    expect(install.cancel(job.id)).toBe(true)
    await tick()
    expect(install.job(job.id)?.state).toBe('cancelled')
  })

  it('reports availability and registry entries', async () => {
    const disabled = await service({ isEnabled: () => false }).info()
    expect(disabled.available).toBe(false)
    expect(disabled.ssh.hosts).toEqual([])
    expect(disabled.registry.entries[0]?.ok).toBe(true)

    const available = await service().info()
    expect(available.available).toBe(true)
    expect(available.ssh.hosts[0]?.alias).toBe('prod')
    expect(available.docker.containers[0]?.name).toBe('harness')
  })
})
