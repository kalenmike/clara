import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { PanelAuthInfo, PanelSessionsResponse, PanelSnapshot } from '@clara/shared-types'
import type { Agent, AgentSessionInfo } from '../src/agent.ts'
import type { ServerConfig } from '../src/config.ts'
import type { HarnessHostResources, HarnessManager } from '../src/harness/manager.ts'
import type { HarnessConnection, HarnessProbe } from '../src/harness/types.ts'
import type { PushService } from '../src/push/service.ts'
import type { RelayClient, RelaySnapshot } from '../src/relay-client.ts'
import type { DeviceInfo } from '../src/store/devices.ts'
import { PanelLog } from '../src/panel/log.ts'
import { PanelRuntime, type PanelRuntimeOptions } from '../src/panel/runtime.ts'
import type { SessionMonitor } from '../src/sessions/monitor.ts'
import { TrafficMeter } from '../src/traffic.ts'

const tempDirs: string[] = []
const AUTH: PanelAuthInfo = { username: 'admin', role: 'superadmin' }

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'clara-runtime-'))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function config(dir: string): ServerConfig {
  return {
    local: { host: '127.0.0.1', bindHost: '127.0.0.1', port: 8788 },
    relay: {
      url: 'wss://relay.example',
      room: 'room-123',
      agentToken: 'sentinel-agent-token',
    },
    pairingBaseUrl: 'https://clara.example',
    adapterRegistryUrl: 'https://clara.example/adapters',
    configDir: dir,
    configPath: join(dir, 'server.json'),
    dataDir: dir,
    dbPath: join(dir, 'clara.db'),
    sources: {
      localHost: 'default',
      localBindHost: 'default',
      localPort: 'default',
      relayUrl: 'file',
      relayRoom: 'file',
      agentToken: 'env',
      pairingBaseUrl: 'default',
      adapterRegistryUrl: 'default',
    },
  }
}

function agent(sessions: AgentSessionInfo[]): Agent {
  return { getSnapshot: () => sessions } as unknown as Agent
}

function relayClient(snapshot: RelaySnapshot): RelayClient {
  return { getSnapshot: () => snapshot } as unknown as RelayClient
}

function pushService(): PushService {
  return { count: 2, failing: 1, publicKey: 'public-key' } as unknown as PushService
}

function devices(): DeviceInfo[] {
  const now = Date.now()
  return [
    {
      id: 'device-local',
      label: 'Desk',
      fingerprint: 'device-fingerprint-1',
      createdAt: now - 60_000,
      updatedAt: now - 1_000,
      lastSeenAt: now - 1_000,
      lastTransport: 'local',
      lastDeviceClass: 'desktop',
    },
    {
      id: 'device-remote',
      label: 'Phone',
      alias: 'Pocket',
      fingerprint: 'device-fingerprint-2',
      createdAt: now - 30_000,
      updatedAt: now - 500,
      lastSeenAt: now - 500,
      lastTransport: 'relay',
      lastDeviceClass: 'mobile',
    },
  ]
}

function harnessConnection(): HarnessConnection {
  const now = Date.now()
  return {
    id: 'harness-1',
    harnessId: 'harness-a',
    kind: 'opencode',
    label: 'Test OpenCode',
    transport: 'local',
    online: true,
    fingerprint: 'harness-fingerprint',
    capabilities: {},
    lastTestAt: now,
    lastTestOk: true,
    createdAt: now,
    updatedAt: now,
    credentialConfigured: true,
  }
}

function fakeHarness(options: {
  probe?: HarnessProbe
  probeCalls?: { value: number }
  host?: HarnessHostResources
  hostCalls?: { value: number }
}): HarnessManager {
  const connection = harnessConnection()
  return {
    configured: true,
    generation: 1,
    active: connection,
    lastError: undefined,
    list: () => [connection],
    hostResources: async () => {
      if (options.hostCalls) options.hostCalls.value += 1
      return options.host ?? { state: 'unavailable' }
    },
    probe: async () => {
      if (options.probeCalls) options.probeCalls.value += 1
      return (
        options.probe ?? {
          ok: true,
          version: '2.1.1',
          latencyMs: 4,
          code: 'ok',
        }
      )
    },
    redactionValues: async () => ['sentinel-password'],
  } as unknown as HarnessManager
}

function createRuntime(
  dir: string,
  options: {
    probe?: HarnessProbe
    probeCalls?: { value: number }
    host?: HarnessHostResources
    hostCalls?: { value: number }
    relay?: RelaySnapshot
    traffic?: TrafficMeter
    localSessions?: AgentSessionInfo[]
    relaySessions?: AgentSessionInfo[]
    sessions?: {
      load: () => Promise<PanelSessionsResponse>
    }
  } = {}
): PanelRuntime {
  const runtimeOptions: PanelRuntimeOptions = {
    config: config(dir),
    harness: fakeHarness(options),
    localAgent: agent(
      options.localSessions ?? [
        {
          sid: 'local-sid',
          kind: 'device',
          deviceId: 'device-local',
          deviceLabel: 'Desk',
          connectedAt: Date.now() - 5_000,
          lastSeen: Date.now() - 1_000,
          requests: 2,
          bytesIn: 2_048,
          bytesOut: 1_024,
          requestsTotal: 7,
          deviceClass: 'desktop',
          presenceAt: Date.now() - 1_000,
          holdPhone: true,
        },
      ]
    ),
    relayAgent: () =>
      agent(
        options.relaySessions ?? [
          {
            sid: 'relay-sid',
            kind: 'device',
            deviceId: 'device-remote',
            deviceLabel: 'Phone',
            connectedAt: Date.now() - 3_000,
            lastSeen: Date.now() - 500,
            requests: 0,
            bytesIn: 512,
            bytesOut: 256,
            requestsTotal: 1,
            deviceClass: 'mobile',
            presenceAt: Date.now() - 500,
            holdPhone: false,
          },
        ]
      ),
    relayClient: () =>
      relayClient(
        options.relay ?? {
          status: 'online',
          connectedSince: Date.now() - 10_000,
          lastChangedAt: Date.now() - 10_000,
          reconnectAttempts: 2,
        }
      ),
    localConnections: () => 1,
    ...(options.traffic ? { traffic: options.traffic } : {}),
    push: pushService(),
    pushError: 'push disabled for sentinel-password',
    devices: () => devices(),
    pairedDevices: () => devices().filter((device) => !device.revokedAt).length,
    startedAt: Date.now() - 60_000,
    secretKey: { path: join(dir, 'secrets.key'), source: 'generated' },
    ...(options.sessions ? { sessions: options.sessions as unknown as SessionMonitor } : {}),
    log: new PanelLog(),
  }
  return new PanelRuntime(runtimeOptions)
}

describe('PanelRuntime', () => {
  it('builds a read-only snapshot without secret material', async () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'server.json'), '{}', { mode: 0o600 })
    writeFileSync(join(dir, 'subscriptions.json'), '{}', { mode: 0o600 })
    writeFileSync(join(dir, 'secrets.key'), 'secret', { mode: 0o600 })
    mkdirSync(join(dir, 'nested'), { recursive: true })

    const runtime = createRuntime(dir, {
      probe: {
        ok: false,
        code: 'auth',
        latencyMs: 1,
        message: 'auth failed for sentinel-password',
      },
    })
    const snapshot = await runtime.snapshot(AUTH)
    const serialized = JSON.stringify(snapshot)

    expect(serialized).not.toContain('sentinel-password')
    expect(serialized).not.toContain('sentinel-agent-token')
    expect(serialized).not.toContain('user:secret')

    expect(snapshot.auth).toEqual(AUTH)
    expect(snapshot.harness).toMatchObject({ configured: true, paired: 1, online: 1 })
    expect(snapshot.push.error).toContain('[redacted]')
    expect(snapshot.agent.pairedDevices).toBe(2)
    expect(snapshot.devices).toHaveLength(2)
    expect(snapshot.devices.find((device) => device.id === 'device-remote')?.alias).toBe('Pocket')
    expect(snapshot.devices.find((device) => device.id === 'device-local')).not.toHaveProperty(
      'alias'
    )
    expect(snapshot.harness.configured).toBe(true)
    expect(snapshot.harnesses).toHaveLength(1)
    expect(snapshot.config.vapidSubject).toEqual({
      value: 'https://clara.local',
      source: 'default',
    })
    expect(snapshot.local.connections).toBe(1)
    expect(snapshot.relay.status).toBe('online')
    expect(snapshot.clients.map((client) => client.transport)).toEqual(['local', 'relay'])
    expect(snapshot.clients.map((client) => client.kind)).toEqual(['device', 'device'])
    expect(snapshot.storage.map((entry) => entry.key)).toEqual([
      'config',
      'subscriptions',
      'vapid',
      'setup-token',
      'secret-key',
    ])
    expect(snapshot.storage[0]?.status).toBe('ok')
  })

  it('redacts secrets from relay errors', async () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'server.json'), '{}', { mode: 0o600 })
    const runtime = createRuntime(dir, {
      relay: {
        status: 'reconnecting',
        lastChangedAt: Date.now(),
        reconnectAttempts: 3,
        lastError: 'relay rejected sentinel-agent-token',
      },
    })
    const snapshot = await runtime.snapshot(AUTH)
    expect(snapshot.relay.lastError).toContain('[redacted]')
    expect(snapshot.relay.lastError).not.toContain('sentinel-agent-token')
  })

  it('reports when another hub took the relay room', async () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'server.json'), '{}', { mode: 0o600 })
    const replacedAt = Date.now() - 5_000
    const runtime = createRuntime(dir, {
      relay: {
        status: 'reconnecting',
        lastChangedAt: Date.now(),
        reconnectAttempts: 1,
        replacedAt,
        lastError:
          'Another hub connected to this room. Check for a second hub using the same token, or rotate the hub token.',
      },
    })
    const snapshot = await runtime.snapshot(AUTH)
    expect(snapshot.relay.replacedAt).toBe(replacedAt)
  })

  it('omits the relay replacement timestamp when no hub was replaced', async () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'server.json'), '{}', { mode: 0o600 })
    const runtime = createRuntime(dir)
    const snapshot = await runtime.snapshot(AUTH)
    expect(snapshot.relay).not.toHaveProperty('replacedAt')
  })

  it('redacts secrets from session monitor errors', async () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'server.json'), '{}', { mode: 0o600 })
    const runtime = createRuntime(dir, {
      sessions: {
        load: async () => ({
          generatedAt: new Date(0).toISOString(),
          sessions: [],
          harnesses: [
            {
              harnessID: 'harness-a',
              label: 'Test OpenCode',
              kind: 'opencode',
              online: false,
              active: true,
              ok: false,
              code: 'upstream_error',
              message: 'adapter failed with sentinel-password',
              sessionCount: 0,
              runningCount: 0,
            },
          ],
          truncated: false,
        }),
      },
    })

    const result = await runtime.sessions({})
    expect(result.harnesses[0]?.message).toContain('[redacted]')
    expect(result.harnesses[0]?.message).not.toContain('sentinel-password')
  })

  it('reports adapter sessions with harness identity and fingerprint', async () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'server.json'), '{}', { mode: 0o600 })
    const runtime = createRuntime(dir, {
      localSessions: [
        {
          sid: 'adapter-sid',
          kind: 'adapter',
          adapterId: 'adapter-a',
          harnessId: 'harness-a',
          connectedAt: Date.now() - 2_000,
          lastSeen: Date.now() - 500,
          requests: 1,
          bytesIn: 128,
          bytesOut: 64,
          requestsTotal: 2,
          holdPhone: false,
        },
      ],
      relaySessions: [],
    })

    const snapshot = await runtime.snapshot(AUTH)

    expect(snapshot.clients).toEqual([
      expect.objectContaining({
        sid: 'adapter-sid',
        kind: 'adapter',
        transport: 'local',
        adapterId: 'adapter-a',
        harnessId: 'harness-a',
      }),
    ])
    expect(snapshot.harnesses[0]?.fingerprint).toBe('harness-fingerprint')
  })

  it('warns about broad config permissions without revealing contents', async () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'server.json'), '{"secret":"do-not-show"}', { mode: 0o644 })
    const runtime = createRuntime(dir)
    const snapshot = await runtime.snapshot(AUTH)
    const configEntry = snapshot.storage.find((entry) => entry.key === 'config')

    expect(configEntry?.status).toBe('warn')
    expect(configEntry?.mode).toBe('644')
    expect(JSON.stringify(snapshot)).not.toContain('do-not-show')
  })

  it('reports a missing required config without failing the snapshot', async () => {
    const dir = tempDir()
    const runtime = createRuntime(dir)
    const snapshot: PanelSnapshot = await runtime.snapshot(AUTH)
    const configEntry = snapshot.storage.find((entry) => entry.key === 'config')

    expect(configEntry?.exists).toBe(false)
    expect(configEntry?.status).toBe('warn')
  })

  it('reports traffic totals and per-client counters while monitoring is on', async () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'server.json'), '{}', { mode: 0o600 })
    const traffic = new TrafficMeter({ enabled: true })
    traffic.recordInbound(1_000, 'local')
    traffic.recordOutbound(2_000, 'local')
    traffic.recordRequest('local')
    traffic.recordError('refused')

    const runtime = createRuntime(dir, { traffic })
    const snapshot = await runtime.snapshot(AUTH)

    expect(snapshot.traffic.enabled).toBe(true)
    expect(snapshot.traffic.totals).toMatchObject({ bytesIn: 1_000, bytesOut: 2_000, requests: 1 })
    expect(snapshot.traffic.errors.refused).toBe(1)
    expect(snapshot.traffic.byTransport.local.requests).toBe(1)
    expect(snapshot.traffic.series).toHaveLength(1)
    expect(snapshot.controls.monitoring).toEqual({ enabled: true })
    expect(snapshot.clients[0]).toMatchObject({ bytesIn: 2_048, requestsTotal: 7 })
  })

  it('omits per-client counters while monitoring is off', async () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'server.json'), '{}', { mode: 0o600 })
    const runtime = createRuntime(dir, { traffic: new TrafficMeter({ enabled: false }) })
    const snapshot = await runtime.snapshot(AUTH)

    expect(snapshot.traffic.enabled).toBe(false)
    expect(snapshot.traffic.series).toEqual([])
    expect(snapshot.clients[0]?.bytesIn).toBeUndefined()
    expect(snapshot.clients[0]?.requestsTotal).toBeUndefined()
    expect(snapshot.controls.monitoring).toEqual({ enabled: false })
  })

  it('attaches live host resources to the online harness and caches the sample', async () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'server.json'), '{}', { mode: 0o600 })
    const hostCalls = { value: 0 }
    const runtime = createRuntime(dir, {
      hostCalls,
      host: {
        state: 'ok',
        metrics: {
          sampledAt: new Date(1_000).toISOString(),
          platform: 'linux',
          arch: 'x64',
          cpu: { cores: 2, hostCores: 4, usagePercent: 25, source: 'cgroup' },
          memory: {
            totalBytes: 4 * 1024 ** 3,
            freeBytes: 1024 ** 3,
            usedPercent: 75,
            source: 'cgroup',
            hostTotalBytes: 16 * 1024 ** 3,
          },
          disks: [
            {
              label: 'Adapter data',
              path: '/data',
              totalBytes: 100,
              freeBytes: 25,
              usedPercent: 75,
            },
          ],
        },
      },
    })

    const first = await runtime.snapshot(AUTH)
    expect(first.harnesses[0]?.resources).toMatchObject({ platform: 'linux' })
    expect(first.harnesses[0]?.resources?.cpu.usagePercent).toBe(25)

    const second = await runtime.snapshot(AUTH)
    expect(second.harnesses[0]?.resources).toEqual(first.harnesses[0]?.resources)
    expect(hostCalls.value).toBe(1)
  })

  it('leaves harness resources empty when the adapter does not support them', async () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'server.json'), '{}', { mode: 0o600 })
    const hostCalls = { value: 0 }
    const runtime = createRuntime(dir, {
      hostCalls,
      host: { state: 'unsupported' },
    })

    const first = await runtime.snapshot(AUTH)
    expect(first.harnesses[0]?.resources).toBeUndefined()

    await runtime.snapshot(AUTH)
    expect(hostCalls.value).toBe(1)
  })
})
