import { accessSync, constants, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  DEFAULT_SYNC_INTERVAL_MS,
  PANEL_API_VERSION,
  PROTOCOL_VERSION,
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
  type PanelOpenCodeInfo,
  type PanelRelayTransport,
  type PanelSnapshot,
  type PanelStorageEntry,
  type PanelTraffic,
} from '@clara/shared-types'
import type { Agent } from '../agent.ts'
import type { ServerConfig } from '../config.ts'
import type { HarnessManager } from '../harness/manager.ts'
import type { HarnessProbe } from '../harness/types.ts'
import { harnessList, harnessState } from './harness.ts'
import type { PushService } from '../push/service.ts'
import { readVapidSubject } from '../push/vapid.ts'
import type { RelayClient } from '../relay-client.ts'
import type { ClientStorageStats } from '../store/client-storage.ts'
import type { DeviceInfo } from '../store/devices.ts'
import { emptyTraffic, type TrafficMeter } from '../traffic.ts'
import { SERVER_VERSION } from '../version.ts'
import type { PanelLog } from './log.ts'

const PROBE_TTL_MS = 5_000
const MAX_ERROR_LENGTH = 240

export type PanelDatabaseSource = {
  path: string
  schemaVersion: number
  sync: () => ClientStorageStats
}

export type PanelRuntimeOptions = {
  config: ServerConfig
  harness: HarnessManager
  localAgent: Agent
  relayAgent?: Agent
  relayClient?: RelayClient
  localConnections: () => number
  traffic?: TrafficMeter
  push?: PushService
  pushError?: string
  devices: () => DeviceInfo[]
  pairedDevices: () => number
  startedAt: number
  controls?: () => PanelControls
  probeEnabled?: () => boolean
  secretKey?: { path?: string; source: string }
  database?: PanelDatabaseSource
  log: PanelLog
}

export type PanelDataSource = {
  snapshot: (auth: PanelAuthInfo) => Promise<PanelSnapshot>
}

/**
 * Joins the live pieces of the hub service into one read-only snapshot. Nothing
 * here mutates the hub service, and the snapshot is built from an explicit allowlist
 * so secrets cannot leak by serializing the config object.
 */
export class PanelRuntime implements PanelDataSource {
  private readonly options: PanelRuntimeOptions
  private probeCache: { at: number; generation: number; result: HarnessProbe } | undefined
  private probeInFlight: Promise<HarnessProbe> | undefined
  private harnessSecrets: string[] = []

  constructor(options: PanelRuntimeOptions) {
    this.options = options
  }

  async snapshot(auth: PanelAuthInfo): Promise<PanelSnapshot> {
    const now = Date.now()
    this.harnessSecrets = await this.options.harness.redactionValues()
    const controls = this.controlsSnapshot()
    const probe = await this.getProbe(controls)
    const traffic = this.trafficSnapshot()
    const { config } = this.options
    const local = controlFor(controls, 'local')
    const relay = controlFor(controls, 'relay')
    const push = controlFor(controls, 'push')
    const harness = this.harnessState()

    return {
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
      opencode: this.openCodeSnapshot(probe, now, controlFor(controls, 'opencode')),
      harness,
      harnesses: this.harnessList(),
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
        publicKeyConfigured: Boolean(this.options.push?.publicKey),
        ...(this.options.pushError || push.error
          ? { error: this.redact(this.options.pushError ?? push.error ?? '') }
          : {}),
      },
      controls,
      storage: this.storageEntries(),
      events: this.events(),
      traffic,
    }
  }

  private openCodeSnapshot(
    probe: HarnessProbe,
    now: number,
    control: PanelFeatureControl
  ): PanelOpenCodeInfo {
    const active = this.options.harness.active
    const error = control.error ?? this.options.harness.lastError ?? probe.message
    return {
      url: active ? `${active.kind} adapter (${active.transport})` : '',
      passwordConfigured: active?.credentialConfigured === true,
      reachable: probe.ok,
      desired: control.desired,
      effective: control.effective,
      configured: this.options.harness.configured,
      ...(probe.version ? { version: probe.version } : {}),
      latencyMs: probe.latencyMs,
      checkedAt: new Date(this.probeCache?.at ?? now).toISOString(),
      code: probe.code,
      ...(error ? { error: this.redact(error) } : {}),
    }
  }

  private harnessState(): PanelHarnessState {
    const state = harnessState(this.options.harness)
    return state.error ? { ...state, error: this.redact(state.error) } : state
  }

  private harnessList(): PanelHarness[] {
    return harnessList(this.options.harness)
  }

  private relaySnapshot(stopped: boolean, control: PanelFeatureControl): PanelRelayTransport {
    const relay = this.options.config.relay
    if (!relay || !this.options.relayClient) {
      return {
        configured: false,
        status: 'disabled',
        desired: control.desired,
        effective: false,
        agentTokenConfigured: false,
        clientTokenConfigured: false,
        ...(control.error ? { error: this.redact(control.error) } : {}),
      }
    }

    const snapshot = this.options.relayClient.getSnapshot()
    const status: PanelRelayTransport['status'] = stopped
      ? 'stopped'
      : !control.desired
        ? 'disabled'
        : snapshot.status
    return {
      configured: true,
      url: relay.url,
      room: relay.room,
      status,
      desired: control.desired,
      effective: control.effective,
      agentTokenConfigured: Boolean(relay.agentToken),
      clientTokenConfigured: Boolean(relay.clientToken),
      ...(snapshot.connectedSince !== undefined
        ? { connectedSince: new Date(snapshot.connectedSince).toISOString() }
        : {}),
      lastChangedAt: new Date(snapshot.lastChangedAt).toISOString(),
      reconnectAttempts: snapshot.reconnectAttempts,
      ...(snapshot.lastError ? { lastError: this.redact(snapshot.lastError) } : {}),
      ...(control.error ? { error: this.redact(control.error) } : {}),
    }
  }

  private clientsSnapshot(now: number, includeTraffic: boolean): PanelClientInfo[] {
    const clients: PanelClientInfo[] = []
    for (const session of this.options.localAgent.getSnapshot(now)) {
      clients.push(toClient(session, 'local', now, includeTraffic))
    }
    for (const session of this.options.relayAgent?.getSnapshot(now) ?? []) {
      clients.push(toClient(session, 'relay', now, includeTraffic))
    }
    return clients.sort((left, right) => left.connectedAt.localeCompare(right.connectedAt))
  }

  private devicesSnapshot(): PanelDeviceInfo[] {
    const live = new Map<string, number>()
    for (const session of this.options.localAgent.getSnapshot()) {
      if (session.deviceId) live.set(session.deviceId, (live.get(session.deviceId) ?? 0) + 1)
    }
    for (const session of this.options.relayAgent?.getSnapshot() ?? []) {
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

  private async getProbe(controls: PanelControls): Promise<HarnessProbe> {
    if (!this.options.harness.configured) {
      return {
        ok: false,
        latencyMs: 0,
        code: 'unconfigured',
        message: this.options.harness.lastError ?? 'No harness connection is configured',
      }
    }
    if (!controlFor(controls, 'opencode').effective || this.options.probeEnabled?.() === false) {
      return {
        ok: false,
        latencyMs: 0,
        code: 'disabled',
        message: 'Harness access is disabled by an admin setting',
      }
    }

    const now = Date.now()
    const generation = this.options.harness.generation
    if (
      this.probeCache &&
      this.probeCache.generation === generation &&
      now - this.probeCache.at < PROBE_TTL_MS
    ) {
      return this.probeCache.result
    }
    if (!this.probeInFlight) {
      this.probeInFlight = this.options.harness
        .probe()
        .then((result) => {
          this.probeCache = { at: Date.now(), generation, result }
          return result
        })
        .finally(() => {
          this.probeInFlight = undefined
        })
    }
    return this.probeInFlight
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
        'Panel setup token',
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
    const secrets = [
      this.options.config.relay?.agentToken,
      this.options.config.relay?.clientToken,
      ...this.harnessSecrets,
    ].filter((secret): secret is string => Boolean(secret))

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
    const writable = canWrite(path)
    const details: string[] = []
    let status: PanelStorageEntry['status'] = 'ok'

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
        writable: canWrite(dirname(path)),
        status: required ? 'warn' : 'ok',
        detail: required ? 'File does not exist' : 'Nothing stored yet',
      }
    }
    return {
      key,
      label,
      path,
      exists: false,
      writable: false,
      status: 'error',
      detail: clip(errorMessage(cause), MAX_ERROR_LENGTH),
    }
  }
}

function canWrite(path: string): boolean {
  try {
    accessSync(path, constants.W_OK)
    return true
  } catch {
    return false
  }
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
