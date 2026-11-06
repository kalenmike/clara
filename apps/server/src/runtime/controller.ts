import type {
  AgentInfo,
  PanelControls,
  PanelFeatureControl,
  PanelSyncUpdate,
  ShellPolicy,
} from '@clara/shared-types'
import type { WebSocket } from 'ws'
import { Agent } from '../agent.ts'
import type { ClaraManagement } from '../clara/index.ts'
import type { ServerConfig } from '../config.ts'
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
  clara?: ClaraManagement
  fingerprint?: string
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
    options.info.management = Boolean(options.clara) && options.settings.getManagement()

    this.localAgent = new Agent({
      openCode: options.openCode,
      psk: config.psk,
      info: options.info,
      send: (frame) => broadcast(this.localSockets, frame),
      push: options.push,
      sync: options.sync,
      pipelineCatalog: () => options.clara?.pipelineCatalog(),
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
        pipelineCatalog: () => options.clara?.pipelineCatalog(),
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
        suppressSession: options.clara?.suppressSession,
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

  get clara(): ClaraManagement | undefined {
    return this.options.clara
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

  connectedClients(): number {
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
      management: { enabled: Boolean(this.options.clara) && settings.management },
    }
  }

  async start(): Promise<void> {
    const settings = this.options.settings.get()
    // Reconcile agents saved before this process started, so an existing
    // management choice is reflected even when nobody touches the panel.
    await this.options.clara?.applyAgentVisibility(settings.management)
    if (settings.stopped) {
      this.options.log('agent stopped by an admin setting; only the panel and database are running')
      return
    }
    await this.applyDesired()
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
   * Clara management is the master switch for the ledger daemon, the generated
   * Clara agents, and their exception sessions. It is independent of the
   * transport stop flag.
   */
  async setManagement(enabled: boolean): Promise<PanelControls> {
    const previous = this.options.settings.getManagement()
    const next = Boolean(this.options.clara) && enabled
    this.options.settings.setManagement(next)
    this.options.info.management = next
    await this.options.clara?.applyAgentVisibility(next, { forceReload: previous !== next })

    this.localAgent.broadcastAgentInfo()
    this.relayAgent?.broadcastAgentInfo()
    if (previous !== next) {
      this.options.log(next ? 'Clara management enabled' : 'Clara management disabled')
    }
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
      this.localAgent.reset()
      this.relayAgent?.reset()
      return this.controls()
    }

    this.options.log('agent started by an admin setting')
    await this.applyDesired()
    return this.controls()
  }

  async close(): Promise<void> {
    await this.stopLocal('agent shutting down')
    this.relayClient?.close()
    this.stopPushMonitor()
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
