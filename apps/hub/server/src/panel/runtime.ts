import { accessSync, constants, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  DEFAULT_SYNC_INTERVAL_MS,
  PANEL_API_VERSION,
  PROTOCOL_VERSION,
  type HostResourceMetrics,
  type PanelAuthInfo,
  type PanelClientInfo,
  type PanelConfigInfo,
  type PanelControls,
  type PanelDeviceInfo,
  type PanelEvent,
  type PanelFeatureControl,
  type PanelFeatureName,
  type PanelHarness,
  type PanelHarnessState,
  type PanelRelayTransport,
  type PanelSessionHarness,
  type PanelSessionsQuery,
  type PanelSessionsResponse,
  type PanelSnapshot,
  type PanelStorageEntry,
  type PanelTraffic,
} from '@clara/shared-types'
import type { Agent } from '../agent.ts'
import type { ServerConfig } from '../config.ts'
import type { HarnessHostResources, HarnessManager } from '../harness/manager.ts'
import { harnessList, harnessState } from './harness.ts'
import type { PushService } from '../push/service.ts'
import { readVapidSubject } from '../push/vapid.ts'
import type { RelayClient } from '../relay-client.ts'
import type { ClientStorageStats } from '../store/client-storage.ts'
import type { DeviceInfo } from '../store/devices.ts'
import { emptyTraffic, type TrafficMeter } from '../traffic.ts'
import { SERVER_VERSION } from '../version.ts'
import type { PanelLog } from './log.ts'
import type { PanelFeature } from './feature.ts'
import type { SessionMonitor } from '../sessions/monitor.ts'

const HOST_METRICS_TTL_MS = 5_000
const HOST_METRICS_RETENTION_MS = 30_000
const MAX_ERROR_LENGTH = 240

type HostMetricsCacheEntry = {
  generation: number
  at: number
  metrics?: HostResourceMetrics
  unsupported?: boolean
}

export type PanelDatabaseSource = {
  path: string
  schemaVersion: number
  sync: () => ClientStorageStats
}

export type PanelRuntimeOptions = {
  config: ServerConfig
  harness: HarnessManager
  localAgent: Agent
  relayAgent: () => Agent | undefined
  relayClient: () => RelayClient | undefined
  localConnections: () => number
  traffic?: TrafficMeter
  push?: PushService
  pushError?: string
  devices: () => DeviceInfo[]
  pairedDevices: () => number
  startedAt: number
  controls?: () => PanelControls
  probeEnabled?: () => boolean
  sessions?: SessionMonitor
  secretKey?: { path?: string; source: string }
  database?: PanelDatabaseSource
  feature?: PanelFeature
  log: PanelLog
}

export type PanelDataSource = {
  snapshot: (auth: PanelAuthInfo) => Promise<PanelSnapshot>
  sessions?: (query: PanelSessionsQuery) => Promise<PanelSessionsResponse>
}

/**
 * Joins the live pieces of the hub service into one read-only snapshot. Nothing
 * here mutates the hub service, and the snapshot is built from an explicit allowlist
 * so secrets cannot leak by serializing the config object.
 */
export class PanelRuntime implements PanelDataSource {
  private readonly options: PanelRuntimeOptions
  private hostCache = new Map<string, HostMetricsCacheEntry>()
  private hostInFlight = new Map<string, Promise<HarnessHostResources>>()
  private harnessSecrets: string[] = []

  constructor(options: PanelRuntimeOptions) {
    this.options = options
  }

  async snapshot(auth: PanelAuthInfo): Promise<PanelSnapshot> {
    const now = Date.now()
    this.options.push?.refreshStorage()
    this.harnessSecrets = await this.options.harness.redactionValues()
    const controls = this.controlsSnapshot()
    const hostEnabled =
      controlFor(controls, 'opencode').effective && this.options.probeEnabled?.() !== false
    const hostMetrics = hostEnabled
      ? await this.hostMetricsSnapshot(now)
      : new Map<string, HostResourceMetrics>()
    const traffic = this.trafficSnapshot()
    const { config } = this.options
    const local = controlFor(controls, 'local')
    const relay = controlFor(controls, 'relay')
    const push = controlFor(controls, 'push')
    const harness = this.harnessState(controlFor(controls, 'opencode'))

    const snapshot: PanelSnapshot = {
      apiVersion: PANEL_API_VERSION,
      generatedAt: new Date(now).toISOString(),
      agent: {
        version: SERVER_VERSION,
        protocol: PROTOCOL_VERSION,
        startedAt: new Date(this.options.startedAt).toISOString(),
        uptimeMs: Math.max(0, now - this.options.startedAt),
        pid: process.pid,
        node: process.version,
        platform: process.platform,
        arch: process.arch,
        memoryRssBytes: process.memoryUsage().rss,
        configPath: config.configPath,
        configDir: config.configDir,
        pairedDevices: this.options.pairedDevices(),
        stopped: controls.stopped,
        container: isContainerized(),
      },
      auth,
      config: panelConfigInfo(config),
      harness,
      harnesses: this.harnessList(hostMetrics),
      harnessPairings: [],
      local: {
        host: config.local.host,
        port: config.local.port,
        url: `ws://${formatHost(config.local.host)}:${config.local.port}/ws`,
        connections: this.options.localConnections(),
        desired: local.desired,
        active: local.desired && local.effective,
        effective: local.effective,
        ...(local.error ? { error: this.redact(local.error) } : {}),
      },
      relay: this.relaySnapshot(controls.stopped, relay),
      clients: this.clientsSnapshot(now, traffic.enabled),
      devices: this.devicesSnapshot(),
      push: {
        enabled: push.effective,
        desired: push.desired,
        effective: push.effective,
        subscriptions: this.options.push?.count ?? 0,
        failing: this.options.push?.failing ?? 0,
        vapidConfigured: Boolean(this.options.push?.publicKey),
        storageAvailable: this.options.push?.storageAvailable ?? false,
        ...(this.options.push?.storageError
          ? { storageError: this.redact(this.options.push.storageError) }
          : {}),
        ...(this.options.pushError || push.error
          ? { error: this.redact(this.options.pushError ?? push.error ?? '') }
          : {}),
      },
      controls,
      storage: this.storageEntries(),
      events: this.events(),
      traffic,
    }
    await this.options.feature?.decorateSnapshot?.(snapshot)
    return snapshot
  }

  async sessions(query: PanelSessionsQuery): Promise<PanelSessionsResponse> {
    if (!this.options.sessions) throw new Error('Session monitoring is unavailable')
    this.harnessSecrets = await this.options.harness.redactionValues()
    const result = await this.options.sessions.load(query)
    return {
      ...result,
      harnesses: result.harnesses.map((harness) => this.redactSessionStatus(harness)),
    }
  }

  private redactSessionStatus(harness: PanelSessionHarness): PanelSessionHarness {
    return harness.message ? { ...harness, message: this.redact(harness.message) } : harness
  }

  private harnessState(control: PanelFeatureControl): PanelHarnessState {
    const state = harnessState(this.options.harness, control)
    const error = control.error ?? state.error
    return error ? { ...state, error: this.redact(error) } : state
  }

  private harnessList(resources: Map<string, HostResourceMetrics>): PanelHarness[] {
    return harnessList(this.options.harness).map((harness) => {
      const metrics = resources.get(harness.harnessId)
      return metrics ? { ...harness, resources: metrics } : harness
    })
  }

  /**
   * Fetch live host samples for online adapters. Successful samples are cached
   * for the panel's five-second cadence, and one is kept through a short
   * transient failure so the card does not flicker. A 404 is remembered until
   * the adapter reconnects, because capabilities from enrollment may predate the
   * route.
   */
  private async hostMetricsSnapshot(now: number): Promise<Map<string, HostResourceMetrics>> {
    const generation = this.options.harness.generation
    const online = this.options.harness.list().filter((connection) => connection.online)
    const onlineIds = new Set(online.map((connection) => connection.harnessId))
    for (const harnessId of this.hostCache.keys()) {
      if (!onlineIds.has(harnessId)) this.hostCache.delete(harnessId)
    }

    const resources = new Map<string, HostResourceMetrics>()
    await Promise.all(
      online.map(async (connection) => {
        const metrics = await this.hostMetricsFor(connection.harnessId, generation, now)
        if (metrics) resources.set(connection.harnessId, metrics)
      })
    )
    return resources
  }

  private async hostMetricsFor(
    harnessId: string,
    generation: number,
    now: number
  ): Promise<HostResourceMetrics | undefined> {
    const cached = this.hostCache.get(harnessId)
    if (cached && cached.generation === generation) {
      if (cached.unsupported) return undefined
      if (cached.metrics) {
        if (now - cached.at < HOST_METRICS_TTL_MS) return cached.metrics
      } else if (now - cached.at < HOST_METRICS_TTL_MS) {
        // A failed attempt backs off until the next panel poll.
        return undefined
      }
    }

    let pending = this.hostInFlight.get(harnessId)
    if (!pending) {
      pending = this.options.harness.hostResources(harnessId)
      this.hostInFlight.set(harnessId, pending)
      void pending.then(() => {
        if (this.hostInFlight.get(harnessId) === pending) this.hostInFlight.delete(harnessId)
      })
    }
    const outcome = await pending

    if (outcome.state === 'unsupported') {
      this.hostCache.set(harnessId, { generation, at: now, unsupported: true })
      return undefined
    }
    if (outcome.state === 'ok') {
      this.hostCache.set(harnessId, { generation, at: now, metrics: outcome.metrics })
      return outcome.metrics
    }

    if (
      cached?.metrics &&
      cached.generation === generation &&
      now - cached.at < HOST_METRICS_RETENTION_MS
    ) {
      return cached.metrics
    }
    this.hostCache.set(harnessId, { generation, at: now })
    return undefined
  }

  private relaySnapshot(stopped: boolean, control: PanelFeatureControl): PanelRelayTransport {
    const relay = this.options.config.relay
    const relayClient = this.options.relayClient()
    if (!relay || !relayClient) {
      return {
        configured: false,
        status: 'disabled',
        desired: control.desired,
        effective: false,
        agentTokenConfigured: false,
        ...(control.error ? { error: this.redact(control.error) } : {}),
      }
    }

    const snapshot = relayClient.getSnapshot()
    const status: PanelRelayTransport['status'] = stopped
      ? 'stopped'
      : !control.desired
        ? 'disabled'
        : snapshot.status
    const sources = this.options.config.sources
    return {
      configured: true,
      url: relay.url,
      room: relay.room,
      status,
      desired: control.desired,
      effective: control.effective,
      agentTokenConfigured: Boolean(relay.agentToken),
      urlSource: sources.relayUrl,
      roomSource: sources.relayRoom,
      agentTokenSource: relay.agentToken ? sources.agentToken : 'none',
      envManaged:
        sources.relayUrl === 'env' || sources.relayRoom === 'env' || sources.agentToken === 'env',
      roomRegeneratable: sources.relayRoom !== 'env',
      ...(snapshot.connectedSince !== undefined
        ? { connectedSince: new Date(snapshot.connectedSince).toISOString() }
        : {}),
      lastChangedAt: new Date(snapshot.lastChangedAt).toISOString(),
      reconnectAttempts: snapshot.reconnectAttempts,
      ...(snapshot.lastError ? { lastError: this.redact(snapshot.lastError) } : {}),
      ...(snapshot.replacedAt !== undefined ? { replacedAt: snapshot.replacedAt } : {}),
      ...(control.error ? { error: this.redact(control.error) } : {}),
    }
  }

  private clientsSnapshot(now: number, includeTraffic: boolean): PanelClientInfo[] {
    const clients: PanelClientInfo[] = []
    for (const session of this.options.localAgent.getSnapshot(now)) {
      clients.push(toClient(session, 'local', now, includeTraffic))
    }
    for (const session of this.options.relayAgent()?.getSnapshot(now) ?? []) {
      clients.push(toClient(session, 'relay', now, includeTraffic))
    }
    return clients.sort((left, right) => left.connectedAt.localeCompare(right.connectedAt))
  }

  private devicesSnapshot(): PanelDeviceInfo[] {
    const live = new Map<string, number>()
    for (const session of this.options.localAgent.getSnapshot()) {
      if (session.deviceId) live.set(session.deviceId, (live.get(session.deviceId) ?? 0) + 1)
    }
    for (const session of this.options.relayAgent()?.getSnapshot() ?? []) {
      if (session.deviceId) live.set(session.deviceId, (live.get(session.deviceId) ?? 0) + 1)
    }
    return this.options.devices().map((device) => toDevice(device, live.get(device.id) ?? 0))
  }

  private trafficSnapshot(): PanelTraffic {
    return this.options.traffic?.snapshot() ?? emptyTraffic()
  }

  private events(): PanelEvent[] {
    return this.options.log.list()
  }

  private controlsSnapshot(): PanelControls {
    const provided = this.options.controls?.()
    if (provided) return provided

    const relayConfigured = Boolean(this.options.config.relay)
    return {
      stopped: false,
      features: [
        {
          name: 'opencode',
          configured: this.options.harness.configured,
          desired: true,
          effective: this.options.harness.configured,
        },
        { name: 'local', configured: true, desired: true, effective: true },
        { name: 'relay', configured: relayConfigured, desired: true, effective: relayConfigured },
        {
          name: 'push',
          configured: Boolean(this.options.push),
          desired: Boolean(this.options.push),
          effective: Boolean(this.options.push),
        },
      ],
      monitoring: { enabled: this.options.traffic?.enabled ?? false },
      sync: { enabled: true, intervalMs: DEFAULT_SYNC_INTERVAL_MS },
      orchestration: {
        desired: false,
        effective: false,
        state: 'stopped',
        url: '',
      },
      install: { enabled: false },
    }
  }

  private storageEntries(): PanelStorageEntry[] {
    const { config } = this.options
    const entries = [
      describeStorage('config', 'Server config', config.configPath, true),
      describeStorage(
        'subscriptions',
        'Push subscriptions',
        join(config.configDir, 'subscriptions.json'),
        false
      ),
      describeStorage('vapid', 'VAPID keys', join(config.configDir, 'vapid.json'), false),
      describeStorage(
        'setup-token',
        'Panel setup or reset token',
        join(config.configDir, 'admin-setup.txt'),
        false
      ),
    ]
    if (this.options.secretKey?.path) {
      entries.push(
        describeStorage('secret-key', 'Harness secret key', this.options.secretKey.path, true)
      )
    } else {
      entries.push({
        key: 'secret-key',
        label: 'Harness secret key',
        path: this.options.secretKey?.source ?? 'environment',
        exists: true,
        readable: true,
        writable: false,
        status: 'ok',
        detail: 'Provided by the environment',
      })
    }
    if (this.options.database) {
      const database = this.options.database
      const entry = describeStorage('database', 'Agent database', database.path, true)
      entry.schemaVersion = database.schemaVersion
      if (entry.exists) {
        try {
          entry.sync = database.sync()
        } catch {
          entry.status = 'warn'
          entry.detail = [entry.detail, 'Could not read client sync statistics']
            .filter(Boolean)
            .join('. ')
        }
      }
      entries.push(entry)
    }
    return entries
  }

  private redact(value: string): string {
    const secrets = [this.options.config.relay?.agentToken, ...this.harnessSecrets].filter(
      (secret): secret is string => Boolean(secret)
    )

    let text = value
    for (const secret of secrets) text = text.split(secret).join('[redacted]')
    return clip(text, MAX_ERROR_LENGTH)
  }
}

/** Build the allowlisted configuration section shared by the snapshot and mutations. */
export function panelConfigInfo(config: ServerConfig): PanelConfigInfo {
  const sources = config.sources
  return {
    localHost: { value: config.local.host, source: sources.localHost },
    localPort: { value: config.local.port, source: sources.localPort },
    relayUrl: {
      value: config.relay?.url ?? null,
      source: sources.relayUrl,
    },
    relayRoom: {
      value: config.relay?.room ?? null,
      source: sources.relayRoom,
    },
    pairingBaseUrl: {
      value: config.pairingBaseUrl,
      source: sources.pairingBaseUrl,
    },
    adapterRegistryUrl: {
      value: config.adapterRegistryUrl,
      source: sources.adapterRegistryUrl,
    },
    vapidSubject: readVapidSubject(config.configDir),
  }
}

function isContainerized(): boolean {
  const value = process.env.CLARA_SERVER_CONTAINER?.trim().toLowerCase()
  return value === '1' || value === 'true' || value === 'yes'
}

function toClient(
  session: ReturnType<Agent['getSnapshot']>[number],
  transport: 'local' | 'relay',
  now: number,
  includeTraffic: boolean
): PanelClientInfo {
  return {
    sid: session.sid,
    transport,
    kind: session.kind,
    ...(session.deviceId ? { deviceId: session.deviceId } : {}),
    ...(session.deviceLabel ? { deviceLabel: session.deviceLabel } : {}),
    ...(session.adapterId ? { adapterId: session.adapterId } : {}),
    ...(session.harnessId ? { harnessId: session.harnessId } : {}),
    ...(session.deviceClass ? { deviceClass: session.deviceClass } : {}),
    connectedAt: new Date(session.connectedAt).toISOString(),
    lastSeenAt: new Date(session.lastSeen).toISOString(),
    idleMs: Math.max(0, now - session.lastSeen),
    requests: session.requests,
    ...(includeTraffic
      ? {
          bytesIn: session.bytesIn,
          bytesOut: session.bytesOut,
          requestsTotal: session.requestsTotal,
        }
      : {}),
    holdPhone: session.holdPhone,
  }
}

function toDevice(device: DeviceInfo, liveSessions: number): PanelDeviceInfo {
  return {
    id: device.id,
    label: device.label,
    ...(device.alias ? { alias: device.alias } : {}),
    fingerprint: device.fingerprint,
    createdAt: new Date(device.createdAt).toISOString(),
    ...(device.lastSeenAt !== undefined
      ? { lastSeenAt: new Date(device.lastSeenAt).toISOString() }
      : {}),
    ...(device.lastTransport ? { transport: device.lastTransport } : {}),
    ...(device.lastDeviceClass ? { deviceClass: device.lastDeviceClass } : {}),
    liveSessions,
    ...(device.revokedAt !== undefined
      ? { revokedAt: new Date(device.revokedAt).toISOString() }
      : {}),
  }
}

function controlFor(controls: PanelControls, name: PanelFeatureName): PanelFeatureControl {
  return (
    controls.features.find((feature) => feature.name === name) ?? {
      name,
      configured: false,
      desired: false,
      effective: false,
    }
  )
}

function describeStorage(
  key: PanelStorageEntry['key'],
  label: string,
  path: string,
  required: boolean
): PanelStorageEntry {
  try {
    const stat = statSync(path)
    const mode = (stat.mode & 0o777).toString(8).padStart(3, '0')
    const readable = canAccess(path, constants.R_OK)
    const writable = canAccess(path, constants.W_OK)
    const details: string[] = []
    let status: PanelStorageEntry['status'] = 'ok'

    if (!readable) {
      status = 'warn'
      details.push(`Not readable by the hub service${hubUserDetail()}`)
    }
    if (!writable) {
      status = 'warn'
      details.push('Not writable by the hub service')
    }
    if (process.platform !== 'win32' && (stat.mode & 0o077) !== 0) {
      status = 'warn'
      details.push(`Permissions ${mode}; expected 600`)
    }

    return {
      key,
      label,
      path,
      exists: true,
      readable,
      writable,
      bytes: stat.size,
      modifiedAt: new Date(stat.mtimeMs).toISOString(),
      mode,
      status,
      ...(details.length > 0 ? { detail: details.join('. ') } : {}),
    }
  } catch (cause) {
    if (isMissing(cause)) {
      return {
        key,
        label,
        path,
        exists: false,
        readable: false,
        writable: canAccess(dirname(path), constants.W_OK),
        status: required ? 'warn' : 'ok',
        detail: required ? 'File does not exist' : 'Nothing stored yet',
      }
    }
    return {
      key,
      label,
      path,
      exists: false,
      readable: false,
      writable: false,
      status: 'error',
      detail: clip(errorMessage(cause), MAX_ERROR_LENGTH),
    }
  }
}

function canAccess(path: string, mode: number): boolean {
  try {
    accessSync(path, mode)
    return true
  } catch {
    return false
  }
}

function hubUserDetail(): string {
  if (typeof process.getuid !== 'function') return ''
  return ` (uid ${process.getuid()})`
}

function isMissing(cause: unknown): boolean {
  return (
    typeof cause === 'object' && cause !== null && (cause as { code?: unknown }).code === 'ENOENT'
  )
}

function formatHost(host: string): string {
  return host.includes(':') && !host.startsWith('[') ? `[${host}]` : host
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

function clip(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value
}
