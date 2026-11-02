import type {
  AgentInfo,
  PanelControls,
  PanelFeatureControl,
  PanelSyncUpdate,
  ShellPolicy,
} from '@clara/shared-types'
import type { WebSocket } from 'ws'
import { Agent } from '../agent.ts'
import { syncClaraAgentVisibility, type ClaraAgentSyncResult } from '../clara/agents.ts'
import type { ServerConfig } from '../config.ts'
import { LedgerAlertMonitor } from '../ledger/monitor.ts'
import type { LedgerReader } from '../ledger/reader.ts'
import type { LedgerAlertStore } from '../ledger/store.ts'
import { broadcast, LocalTransport } from '../local-server.ts'
import type { OpenCodeClient } from '../opencode.ts'
import { PushMonitor } from '../push/monitor.ts'
import type { PushService } from '../push/service.ts'
import { RelayClient, type RelayStatus } from '../relay-client.ts'
import type { ClientStorageStore } from '../store/client-storage.ts'
import { FEATURE_NAMES, type FeatureName, type SettingsStore } from '../store/settings.ts'
import { TrafficMeter } from '../traffic.ts'

export type ControllerOptions = {
  config: ServerConfig
  openCode: OpenCodeClient
  info: AgentInfo
  settings: SettingsStore
  sync?: ClientStorageStore
  push?: PushService
  pushError?: string
  ledger?: LedgerReader
  ledgerStore?: LedgerAlertStore
  fingerprint?: string
  /** Test seam; the panel uses the real installer manifest by default. */
  syncClaraAgents?: (enabled: boolean) => ClaraAgentSyncResult
  log: (message: string, detail?: unknown) => void
}

const FEATURE_ORDER: FeatureName[] = ['opencode', 'local', 'relay', 'push']

/**
 * Owns the lifecycle of every outbound transport. Persisted settings are the
 * desired state; the effective state can only be true when the process is not
 * stopped and the transport actually started.
 */
export class RuntimeController {
  private readonly options: ControllerOptions
  private readonly localSockets = new Set<WebSocket>()
  private readonly localAgent: Agent
  private readonly relayAgent?: Agent
  private readonly relayClient?: RelayClient
  private readonly localTransport: LocalTransport
  private readonly pushMonitor?: PushMonitor
  private pushMonitorRunning = false
  private readonly ledgerMonitor?: LedgerAlertMonitor
  private readonly errors = new Map<FeatureName, string>()
  private readonly trafficMeter: TrafficMeter
  /** Command requests refused since this process started. */
  private shellDenied = 0

  constructor(options: ControllerOptions) {
    this.options = options
    const { config } = options
    this.trafficMeter = new TrafficMeter({ enabled: options.settings.getMonitoring() })
    const sync = options.settings.getSync()
    options.info.syncEnabled = sync.enabled
    options.info.syncIntervalMs = sync.intervalMs
    options.info.management = options.settings.getManagement()
    const ledger = options.ledger
      ? {
          enabled: () => options.settings.getManagement(),
          inbox: () => options.ledger!.inbox(),
        }
      : undefined

    this.localAgent = new Agent({
      openCode: options.openCode,
      psk: config.psk,
      info: options.info,
      send: (frame) => broadcast(this.localSockets, frame),
      push: options.push,
      sync: options.sync,
      ledger,
      traffic: this.trafficMeter,
      transport: 'local',
      policy: {
        canProxy: () => this.canProxy(),
        canPush: () => this.canPush(),
        canSync: () => this.canSync(),
        shellPolicy: () => this.shellPolicy(),
        onShellDenied: () => {
          this.shellDenied += 1
        },
      },
      log: options.log,
    })

    if (config.relay) {
      this.relayAgent = new Agent({
        openCode: options.openCode,
        psk: config.psk,
        info: options.info,
        send: (frame) => this.relayClient?.send(frame),
        push: options.push,
        sync: options.sync,
        ledger,
        traffic: this.trafficMeter,
        transport: 'relay',
        policy: {
          canProxy: () => this.canProxy(),
          canPush: () => this.canPush(),
          canSync: () => this.canSync(),
          shellPolicy: () => this.shellPolicy(),
          onShellDenied: () => {
            this.shellDenied += 1
          },
        },
        log: options.log,
      })
      this.relayClient = new RelayClient({
        url: config.relay.url,
        room: config.relay.room,
        agentToken: config.relay.agentToken,
        agent: this.relayAgent,
        log: options.log,
        onStatus: (status) => this.logRelayStatus(status),
      })
    }

    this.localTransport = new LocalTransport({
      host: config.local.host,
      port: config.local.port,
      agent: this.localAgent,
      sockets: this.localSockets,
      log: options.log,
    })

    if (options.push) {
      this.pushMonitor = new PushMonitor({
        openCode: options.openCode,
        push: options.push,
        isDeskActive: () =>
          this.localAgent.deskHoldActive() || (this.relayAgent?.deskHoldActive() ?? false),
        isManagementEnabled: () => options.settings.getManagement(),
        log: options.log,
      })
    }

    if (options.ledger && options.ledgerStore) {
      this.ledgerMonitor = new LedgerAlertMonitor({
        reader: options.ledger,
        store: options.ledgerStore,
        push: options.push,
        enabled: () => options.settings.getManagement() && !options.settings.getStopped(),
        canPush: () => this.canPush(),
        isDeskActive: () =>
          this.localAgent.deskHoldActive() || (this.relayAgent?.deskHoldActive() ?? false),
        hasClients: () => this.connectedClients() > 0,
        broadcast: (alert) => {
          const state = { type: 'ledger.alert' as const, alert }
          this.localAgent.broadcastState(state)
          this.relayAgent?.broadcastState(state)
        },
        log: options.log,
      })
    }
  }

  get agent(): Agent {
    return this.localAgent
  }

  get relay(): Agent | undefined {
    return this.relayAgent
  }

  get relayTransport(): RelayClient | undefined {
    return this.relayClient
  }

  get push(): PushService | undefined {
    return this.options.push
  }

  get pushError(): string | undefined {
    return this.options.pushError
  }

  get localConnections(): number {
    return this.localTransport.connections
  }

  get traffic(): TrafficMeter {
    return this.trafficMeter
  }

  private connectedClients(): number {
    const now = Date.now()
    return this.localAgent.getSnapshot(now).length + (this.relayAgent?.getSnapshot(now).length ?? 0)
  }

  canProxy(): boolean {
    if (this.options.settings.getStopped()) return false
    return this.options.settings.getFeature('opencode')
  }

  canPush(): boolean {
    if (this.options.settings.getStopped()) return false
    return this.options.settings.getFeature('push') && Boolean(this.options.push)
  }

  canSync(): boolean {
    if (this.options.settings.getStopped()) return false
    return this.options.settings.getSyncEnabled()
  }

  /** Read per request so a panel change applies to the next command. */
  shellPolicy(): ShellPolicy {
    return this.options.settings.getShellPolicy()
  }

  controls(): PanelControls {
    const settings = this.options.settings.get()
    const stopped = settings.stopped
    const features: PanelFeatureControl[] = FEATURE_NAMES.map((name) => {
      const desired = settings.features[name]
      const control: PanelFeatureControl = {
        name,
        configured: this.isConfigured(name),
        desired,
        effective: this.isEffective(name, stopped),
      }
      const error = this.errors.get(name)
      if (error) control.error = error
      return control
    })
    return {
      stopped,
      features,
      shell: { ...settings.shell, blocked: this.shellDenied },
      monitoring: { enabled: settings.monitoring },
      sync: { ...settings.sync },
      management: { enabled: settings.management },
    }
  }

  async start(): Promise<void> {
    const settings = this.options.settings.get()
    if (settings.stopped) {
      this.options.log('agent stopped by an admin setting; only the panel and database are running')
      return
    }
    await this.applyDesired()
    this.startLedgerMonitor()
  }

  async setFeature(feature: FeatureName, enabled: boolean): Promise<PanelControls> {
    if (this.options.settings.getStopped()) {
      throw new AgentStoppedError()
    }

    this.options.settings.setFeature(feature, enabled)
    this.errors.delete(feature)
    try {
      await this.applyFeature(feature, enabled)
    } catch (cause) {
      const message = errorMessage(cause)
      this.errors.set(feature, message)
      this.options.log(`could not ${enabled ? 'enable' : 'disable'} ${feature}`, cause)
    }
    return this.controls()
  }

  async setShellPolicy(policy: ShellPolicy): Promise<PanelControls> {
    this.options.settings.setShellPolicy(policy)
    this.options.log(
      policy.mode === 'off'
        ? 'shell commands blocked by an admin setting'
        : policy.commands.length === 0
          ? 'shell commands enabled with no filters'
          : `shell filter updated (${policy.commands.length} command(s))`
    )
    return this.controls()
  }

  /**
   * Monitoring is a panel concern, not a transport: it stays switchable while
   * the agent is stopped. Turning it off discards the window so no stale
   * numbers survive the decision.
   */
  async setMonitoring(enabled: boolean): Promise<PanelControls> {
    this.options.settings.setMonitoring(enabled)
    this.trafficMeter.setEnabled(enabled)
    this.options.log(enabled ? 'traffic monitoring enabled' : 'traffic monitoring disabled')
    return this.controls()
  }

  /**
   * Clara management is the master switch for the ledger daemon, ledger
   * alerts, and the Clara inbox. It is independent of the transport stop flag.
   */
  async setManagement(enabled: boolean): Promise<PanelControls> {
    const previous = this.options.settings.getManagement()
    this.options.settings.setManagement(enabled)
    this.options.info.management = enabled

    const sync = this.options.syncClaraAgents ?? syncClaraAgentVisibility
    let synced: ClaraAgentSyncResult | undefined
    try {
      synced = sync(enabled)
    } catch (cause) {
      this.options.log('could not sync the Clara agent files', cause)
    }
    if (synced?.skipped.length) {
      this.options.log(
        'left edited Clara agent files untouched',
        synced.skipped.map((id) => `${id}.md`).join(', ')
      )
    }

    // Agent files are config inputs, not transport state. Reload OpenCode only
    // when something changed, and never let a reload failure block the switch.
    if (synced?.updated.length && this.canProxy()) {
      try {
        await this.options.openCode.reload()
      } catch (cause) {
        this.options.log('could not reload OpenCode after changing Clara management', cause)
      }
    }

    this.localAgent.broadcastAgentInfo()
    this.relayAgent?.broadcastAgentInfo()
    if (previous !== enabled) {
      this.options.log(enabled ? 'Clara management enabled' : 'Clara management disabled')
    }
    if (enabled) this.startLedgerMonitor({ prime: true })
    else this.stopLedgerMonitor()
    return this.controls()
  }

  /** Update the global sync gate and cadence, then tell connected clients. */
  async setSync(update: PanelSyncUpdate): Promise<PanelControls> {
    const previous = this.options.settings.getSync()
    this.options.settings.setSync(update)
    this.options.info.syncEnabled = update.enabled
    this.options.info.syncIntervalMs = update.intervalMs
    this.localAgent.broadcastAgentInfo()
    this.relayAgent?.broadcastAgentInfo()

    if (previous.enabled !== update.enabled) {
      this.options.log(
        update.enabled ? 'client settings sync enabled' : 'client settings sync disabled'
      )
    }
    if (previous.intervalMs !== update.intervalMs) {
      this.options.log(`client settings sync check interval set to ${update.intervalMs}ms`)
    }
    return this.controls()
  }

  async setStopped(stopped: boolean): Promise<PanelControls> {
    if (this.options.settings.getStopped() === stopped) return this.controls()
    this.options.settings.setStopped(stopped)

    if (stopped) {
      this.errors.clear()
      this.options.log('agent stopped by an admin setting')
      await this.stopLocal()
      this.relayClient?.close()
      this.stopPushMonitor()
      this.stopLedgerMonitor()
      this.localAgent.reset()
      this.relayAgent?.reset()
      return this.controls()
    }

    this.options.log('agent started by an admin setting')
    await this.applyDesired()
    this.startLedgerMonitor()
    return this.controls()
  }

  async close(): Promise<void> {
    await this.stopLocal('agent shutting down')
    this.relayClient?.close()
    this.stopPushMonitor()
    this.stopLedgerMonitor()
    this.localAgent.close()
    this.relayAgent?.close()
  }

  private async applyDesired(): Promise<void> {
    for (const feature of FEATURE_ORDER) {
      const enabled = this.options.settings.getFeature(feature)
      this.errors.delete(feature)
      try {
        await this.applyFeature(feature, enabled)
      } catch (cause) {
        const message = errorMessage(cause)
        this.errors.set(feature, message)
        this.options.log(`could not ${enabled ? 'enable' : 'disable'} ${feature}`, cause)
      }
    }
  }

  private async applyFeature(feature: FeatureName, enabled: boolean): Promise<void> {
    switch (feature) {
      case 'opencode':
        this.syncPushMonitor()
        return
      case 'local':
        if (enabled) {
          await this.localTransport.start()
          this.options.log(
            `local WebSocket listening on ws://${this.options.config.local.host}:${this.options.config.local.port}/ws`
          )
        } else {
          await this.stopLocal('local transport disabled by an admin setting')
          this.localAgent.reset()
        }
        return
      case 'relay':
        if (!enabled) {
          this.relayClient?.close()
          return
        }
        if (!this.relayClient) return
        this.relayClient.start()
        return
      case 'push':
        if (enabled && !this.options.push) {
          throw new Error(this.options.pushError ?? 'Push notifications are not available')
        }
        this.syncPushMonitor()
        return
    }
  }

  private syncPushMonitor(): void {
    const settings = this.options.settings.get()
    const shouldRun =
      !settings.stopped &&
      settings.features.push &&
      settings.features.opencode &&
      Boolean(this.options.push)
    if (!shouldRun) {
      this.stopPushMonitor()
      return
    }
    if (!this.pushMonitor) return
    this.pushMonitor.start()
    this.pushMonitorRunning = true
  }

  private stopPushMonitor(): void {
    this.pushMonitor?.close()
    this.pushMonitorRunning = false
  }

  private startLedgerMonitor(options: { prime?: boolean } = {}): void {
    if (!this.options.settings.getManagement() || this.options.settings.getStopped()) return
    this.ledgerMonitor?.start(options)
  }

  private stopLedgerMonitor(): void {
    this.ledgerMonitor?.stop()
  }

  private async stopLocal(reason = 'local transport disabled'): Promise<void> {
    try {
      await this.localTransport.stop(reason)
    } catch (cause) {
      this.options.log('could not stop the local transport', cause)
    }
  }

  private isConfigured(feature: FeatureName): boolean {
    switch (feature) {
      case 'relay':
        return this.relayConfigured()
      case 'push':
        return Boolean(this.options.push)
      default:
        return true
    }
  }

  private isEffective(feature: FeatureName, stopped: boolean): boolean {
    if (stopped) return false
    switch (feature) {
      case 'opencode':
        return this.options.settings.getFeature('opencode')
      case 'local':
        return this.options.settings.getFeature('local') && this.localTransport.active
      case 'relay':
        return (
          this.options.settings.getFeature('relay') &&
          this.relayConfigured() &&
          (this.relayClient?.isRunning ?? false)
        )
      case 'push':
        return (
          this.options.settings.getFeature('push') &&
          Boolean(this.options.push) &&
          this.pushMonitorRunning
        )
    }
  }

  private relayConfigured(): boolean {
    const relay = this.options.config.relay
    return Boolean(relay?.url && relay.agentToken && relay.clientToken)
  }

  private logRelayStatus(status: RelayStatus): void {
    if (status === 'offline' || status === 'online' || status === 'connecting') {
      const url = this.options.config.relay?.url
      this.options.log(`relay ${status}${url ? ` (${url})` : ''}`)
    }
  }
}

export class AgentStoppedError extends Error {
  readonly code = 'agent_stopped'
  readonly status = 409

  constructor() {
    super('The agent is stopped. Start it before changing features.')
    this.name = 'AgentStoppedError'
  }
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
