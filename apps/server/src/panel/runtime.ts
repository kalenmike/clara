import { accessSync, constants, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  PANEL_API_VERSION,
  PROTOCOL_VERSION,
  type PanelClientInfo,
  type PanelConfigInfo,
  type PanelControls,
  type PanelEvent,
  type PanelFeatureControl,
  type PanelFeatureName,
  type PanelOpenCodeInfo,
  type PanelRelayTransport,
  type PanelSnapshot,
  type PanelStorageEntry,
} from '@clara/shared-types'
import type { Agent } from '../agent.ts'
import type { ServerConfig } from '../config.ts'
import type { OpenCodeClient, OpenCodeProbe } from '../opencode.ts'
import type { PushService } from '../push/service.ts'
import type { RelayClient } from '../relay-client.ts'
import type { ClientStorageStats } from '../store/client-storage.ts'
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
  openCode: OpenCodeClient
  localAgent: Agent
  relayAgent?: Agent
  relayClient?: RelayClient
  localConnections: () => number
  push?: PushService
  pushError?: string
  fingerprint?: string
  startedAt: number
  controls?: () => PanelControls
  probeEnabled?: () => boolean
  database?: PanelDatabaseSource
  log: PanelLog
}

export type PanelDataSource = {
  snapshot: () => Promise<PanelSnapshot>
}

/**
 * Joins the live pieces of the home agent into one read-only snapshot. Nothing
 * here mutates the agent, and the snapshot is built from an explicit allowlist
 * so secrets cannot leak by serializing the config object.
 */
export class PanelRuntime implements PanelDataSource {
  private readonly options: PanelRuntimeOptions
  private probeCache: { at: number; result: OpenCodeProbe } | undefined
  private probeInFlight: Promise<OpenCodeProbe> | undefined

  constructor(options: PanelRuntimeOptions) {
    this.options = options
  }

  async snapshot(): Promise<PanelSnapshot> {
    const now = Date.now()
    const controls = this.controlsSnapshot()
    const probe = await this.getProbe(controls)
    const { config } = this.options
    const local = controlFor(controls, 'local')
    const relay = controlFor(controls, 'relay')
    const push = controlFor(controls, 'push')

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
        pskConfigured: Boolean(config.psk),
        stopped: controls.stopped,
        ...(this.options.fingerprint ? { fingerprint: this.options.fingerprint } : {}),
      },
      config: this.configSnapshot(),
      opencode: this.openCodeSnapshot(probe, now, controlFor(controls, 'opencode')),
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
      clients: this.clientsSnapshot(now),
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
    }
  }

  private configSnapshot(): PanelConfigInfo {
    const { config } = this.options
    const sources = config.sources
    return {
      opencodeUrl: {
        value: displayUrl(config.opencode.url),
        source: sources.opencodeUrl,
      },
      opencodePassword: {
        value: Boolean(config.opencode.password),
        source: sources.opencodePassword,
      },
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
    }
  }

  private openCodeSnapshot(
    probe: OpenCodeProbe,
    now: number,
    control: PanelFeatureControl
  ): PanelOpenCodeInfo {
    return {
      url: displayUrl(this.options.config.opencode.url),
      passwordConfigured: Boolean(this.options.config.opencode.password),
      reachable: probe.ok,
      desired: control.desired,
      effective: control.effective,
      ...(probe.version ? { version: probe.version } : {}),
      latencyMs: probe.latencyMs,
      checkedAt: new Date(this.probeCache?.at ?? now).toISOString(),
      code: probe.code,
      ...((control.error ?? probe.message)
        ? { error: this.redact(control.error ?? probe.message ?? '') }
        : {}),
    }
  }

  private relaySnapshot(
    stopped: boolean,
    control: PanelFeatureControl
  ): PanelRelayTransport {
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

  private clientsSnapshot(now: number): PanelClientInfo[] {
    const clients: PanelClientInfo[] = []
    for (const session of this.options.localAgent.getSnapshot(now)) {
      clients.push(toClient(session, 'local', now))
    }
    for (const session of this.options.relayAgent?.getSnapshot(now) ?? []) {
      clients.push(toClient(session, 'relay', now))
    }
    return clients.sort((left, right) => left.connectedAt.localeCompare(right.connectedAt))
  }

  private events(): PanelEvent[] {
    return this.options.log.list()
  }

  private async getProbe(controls: PanelControls): Promise<OpenCodeProbe> {
    if (!controlFor(controls, 'opencode').effective || this.options.probeEnabled?.() === false) {
      return {
        ok: false,
        latencyMs: 0,
        code: 'disabled',
        message: 'OpenCode access is disabled by an admin setting',
      }
    }

    const now = Date.now()
    if (this.probeCache && now - this.probeCache.at < PROBE_TTL_MS) {
      return this.probeCache.result
    }
    if (!this.probeInFlight) {
      this.probeInFlight = this.options.openCode
        .probe()
        .then((result) => {
          this.probeCache = { at: Date.now(), result }
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
        { name: 'opencode', configured: true, desired: true, effective: true },
        { name: 'local', configured: true, desired: true, effective: true },
        { name: 'relay', configured: relayConfigured, desired: true, effective: relayConfigured },
        {
          name: 'push',
          configured: Boolean(this.options.push),
          desired: Boolean(this.options.push),
          effective: Boolean(this.options.push),
        },
      ],
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
    ]
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
      this.options.config.opencode.password,
      this.options.config.psk,
      this.options.config.relay?.agentToken,
      this.options.config.relay?.clientToken,
    ].filter((secret): secret is string => Boolean(secret))

    let text = value
    for (const secret of secrets) text = text.split(secret).join('[redacted]')
    return clip(text, MAX_ERROR_LENGTH)
  }
}

function toClient(
  session: ReturnType<Agent['getSnapshot']>[number],
  transport: 'local' | 'relay',
  now: number
): PanelClientInfo {
  return {
    sid: session.sid,
    transport,
    ...(session.deviceClass ? { deviceClass: session.deviceClass } : {}),
    connectedAt: new Date(session.connectedAt).toISOString(),
    lastSeenAt: new Date(session.lastSeen).toISOString(),
    idleMs: Math.max(0, now - session.lastSeen),
    requests: session.requests,
    holdPhone: session.holdPhone,
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
      details.push('Not writable by the agent')
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

function displayUrl(value: string): string {
  try {
    const url = new URL(value)
    url.username = ''
    url.password = ''
    return url.toString().replace(/\/$/, '')
  } catch {
    return '[invalid URL]'
  }
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
