import type {
  AgentInfo,
  PanelConfigInfo,
  PanelConfigUpdate,
  PanelControls,
  PanelFeatureControl,
  PanelHarnessMutationResponse,
  PanelHarnessTestResult,
  PanelOrchestrationControl,
  PanelSyncUpdate,
  ShellPolicy,
} from '@clara/shared-types'
import { baseURL } from '@clara/orchestration-control'
import type { WebSocket } from 'ws'
import { Agent } from '../agent.ts'
import {
  defaultPairingBaseUrl,
  normalizePairingBaseUrl,
  savePairingBaseUrl,
  type ServerConfig,
} from '../config.ts'
import type { HarnessManager } from '../harness/manager.ts'
import { HarnessValidationError } from '../harness/types.ts'
import { broadcast, LocalTransport } from '../local-server.ts'
import { PanelControlError } from '../panel/controls.ts'
import { harnessList, harnessState, toPanelHarnessTest } from '../panel/harness.ts'
import { panelConfigInfo } from '../panel/runtime.ts'
import { PushMonitor } from '../push/monitor.ts'
import type { PushService } from '../push/service.ts'
import {
  DEFAULT_VAPID_SUBJECT,
  isValidVapidSubject,
  normalizeVapidSubject,
  readVapidSubject,
  saveVapidSubject,
  validateVapidSubject,
} from '../push/vapid.ts'
import { RelayClient, type RelayStatus } from '../relay-client.ts'
import type { ClientStorageStore } from '../store/client-storage.ts'
import type { DeviceInfo, DeviceStore } from '../store/devices.ts'
import { FEATURE_NAMES, type FeatureName, type SettingsStore } from '../store/settings.ts'
import { TrafficMeter } from '../traffic.ts'
import {
  readOrchestrationControl,
  startOrchestration,
  stopOrchestration,
} from '../orchestration/service.ts'

export type ControllerOptions = {
  config: ServerConfig
  harness: HarnessManager
  info: AgentInfo
  settings: SettingsStore
  sync?: ClientStorageStore
  push?: PushService
  pushError?: string
  devices: DeviceStore
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
  private orchestration: PanelOrchestrationControl = {
    desired: false,
    effective: false,
    state: 'stopped',
    url: baseURL(),
  }
  private orchestrationError: string | undefined
  private orchestrationTimer?: NodeJS.Timeout
  private harnessUnsubscribe?: () => void

  constructor(options: ControllerOptions) {
    this.options = options
    const { config } = options
    this.trafficMeter = new TrafficMeter({ enabled: options.settings.getMonitoring() })
    const sync = options.settings.getSync()
    options.info.syncEnabled = sync.enabled
    options.info.syncIntervalMs = sync.intervalMs
    options.info.orchestration = false

    this.localAgent = new Agent({
      harness: options.harness,
      devices: options.devices,
      info: options.info,
      send: (frame) => broadcast(this.localSockets, frame),
      push: options.push,
      sync: options.sync,
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
        harness: options.harness,
        devices: options.devices,
        info: options.info,
        send: (frame) => this.relayClient?.send(frame),
        push: options.push,
        sync: options.sync,
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
      host: config.local.bindHost,
      port: config.local.port,
      agent: this.localAgent,
      sockets: this.localSockets,
      log: options.log,
    })

    if (options.push) {
      this.pushMonitor = new PushMonitor({
        harness: options.harness,
        push: options.push,
        isDeskActive: () =>
          this.localAgent.deskHoldActive() || (this.relayAgent?.deskHoldActive() ?? false),
        suppressSession: (session) =>
          this.orchestration.effective && session.metadata?.automation === true,
        log: options.log,
      })
    }

    this.harnessUnsubscribe = options.harness.subscribe(() => this.onHarnessChanged())
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

  connectedClients(): number {
    const now = Date.now()
    return this.localAgent.getSnapshot(now).length + (this.relayAgent?.getSnapshot(now).length ?? 0)
  }

  devices(): DeviceInfo[] {
    return this.options.devices.listDevices()
  }

  pairedDevices(): number {
    return this.options.devices.countActive()
  }

  /** Revoke one device, drop its live sessions, and clear its push routes. */
  revokeDevice(id: string): DeviceInfo | undefined {
    const device = this.options.devices.revokeDevice(id)
    if (!device) return undefined
    this.localAgent.abortDevice(id)
    this.relayAgent?.abortDevice(id)
    this.options.push?.removeByDevice(id)
    this.options.log(`device revoked (${id})`)
    return device
  }

  canProxy(): boolean {
    if (this.options.settings.getStopped()) return false
    return this.options.settings.getFeature('opencode') && this.options.harness.configured
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
      orchestration: this.orchestration,
    }
  }

  async start(): Promise<void> {
    const settings = this.options.settings.get()
    if (settings.orchestration) {
      try {
        await startOrchestration()
      } catch (cause) {
        this.orchestrationError = errorMessage(cause)
        this.options.log('could not start orchestration', cause)
      }
    }
    await this.refreshOrchestration()
    this.orchestrationTimer = setInterval(() => {
      void this.refreshOrchestration().catch((cause) => {
        this.options.log('could not read the orchestration status', cause)
      })
    }, 15_000)
    this.orchestrationTimer.unref?.()

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
   * Orchestration is the master switch for the local service and the
   * automation-session treatment. It is independent of the transport stop flag.
   */
  async setOrchestration(enabled: boolean): Promise<PanelControls> {
    const previous = this.options.settings.getOrchestration()
    this.orchestrationError = undefined
    try {
      if (enabled) {
        this.options.settings.setOrchestration(true)
        await startOrchestration()
      } else {
        await stopOrchestration()
        this.options.settings.setOrchestration(false)
      }
    } catch (cause) {
      this.orchestrationError = errorMessage(cause)
      this.options.log(`could not ${enabled ? 'start' : 'stop'} orchestration`, cause)
      await this.refreshOrchestration()
      throw cause
    }

    await this.refreshOrchestration()
    const next = this.options.settings.getOrchestration()
    if (previous !== next) {
      this.options.log(next ? 'orchestration enabled' : 'orchestration disabled')
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

  /**
   * Update the file-backed panel values. The Web URL lives in server.json and
   * the VAPID contact lives in vapid.json, so this is the one config mutation
   * that is not stored in SQLite.
   */
  async updateConfig(update: PanelConfigUpdate): Promise<PanelConfigInfo> {
    const { config } = this.options
    const pairingProvided = Object.prototype.hasOwnProperty.call(update, 'pairingBaseUrl')
    const vapidProvided = Object.prototype.hasOwnProperty.call(update, 'vapidSubject')

    let pairingBaseUrl: string | undefined
    if (pairingProvided) {
      if (config.sources.pairingBaseUrl === 'env') {
        throw new PanelControlError(
          409,
          'env_override',
          'CLARA_PAIRING_BASE_URL is set. Remove it and restart the agent to edit the Web URL here.'
        )
      }
      const value = update.pairingBaseUrl
      if (value !== null && value !== undefined && value.trim()) {
        try {
          pairingBaseUrl = normalizePairingBaseUrl(value)
        } catch (cause) {
          throw new PanelControlError(400, 'invalid_pairing_base_url', errorMessage(cause))
        }
      }
    }

    let vapidSubject: string | undefined
    const currentVapidSubject = readVapidSubject(config.configDir)
    if (vapidProvided) {
      if (currentVapidSubject.source === 'env') {
        throw new PanelControlError(
          409,
          'env_override',
          'CLARA_VAPID_SUBJECT is set. Remove it and restart the agent to edit the VAPID contact here.'
        )
      }
      const value = update.vapidSubject
      if (value !== null && value !== undefined && value.trim()) {
        try {
          validateVapidSubject(value)
          vapidSubject = normalizeVapidSubject(value)
        } catch (cause) {
          throw new PanelControlError(400, 'invalid_vapid_subject', errorMessage(cause))
        }
      }
    }

    // Adopting the first custom HTTPS Web URL also adopts it as the VAPID
    // contact while the contact is still the local default. An explicit panel
    // value or CLARA_VAPID_SUBJECT is never overwritten.
    const followWebUrl =
      pairingProvided &&
      !vapidProvided &&
      pairingBaseUrl !== undefined &&
      currentVapidSubject.source !== 'env' &&
      currentVapidSubject.value === DEFAULT_VAPID_SUBJECT &&
      isValidVapidSubject(pairingBaseUrl)
    const nextVapidSubject = followWebUrl ? pairingBaseUrl : vapidSubject
    const writeVapidSubject = vapidProvided || followWebUrl

    if (pairingProvided) {
      savePairingBaseUrl(config.configPath, pairingBaseUrl)
      config.pairingBaseUrl = pairingBaseUrl ?? defaultPairingBaseUrl()
      config.sources.pairingBaseUrl = pairingBaseUrl ? 'file' : 'default'
    }
    if (writeVapidSubject) {
      saveVapidSubject(config.configDir, nextVapidSubject)
      this.options.push?.setSubject(nextVapidSubject ?? DEFAULT_VAPID_SUBJECT)
    }

    return panelConfigInfo(config)
  }

  async saveHarness(value: unknown, id?: string): Promise<PanelHarnessMutationResponse> {
    await harnessCall(() => this.options.harness.save(value, id))
    return this.harnessMutation()
  }

  async testHarness(value: unknown, id?: string): Promise<PanelHarnessTestResult> {
    return toPanelHarnessTest(await harnessCall(() => this.options.harness.test(value, id)))
  }

  async activateHarness(id: string): Promise<PanelHarnessMutationResponse> {
    await harnessCall(async () => this.options.harness.activate(id))
    return this.harnessMutation()
  }

  async deleteHarness(id: string): Promise<PanelHarnessMutationResponse> {
    await harnessCall(async () => this.options.harness.remove(id))
    return this.harnessMutation()
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
    if (this.orchestrationTimer) clearInterval(this.orchestrationTimer)
    this.orchestrationTimer = undefined
    this.harnessUnsubscribe?.()
    this.harnessUnsubscribe = undefined
    await this.stopLocal('agent shutting down')
    this.relayClient?.close()
    this.stopPushMonitor()
    this.localAgent.close()
    this.relayAgent?.close()
  }

  private async refreshOrchestration(): Promise<void> {
    const next = await readOrchestrationControl(
      this.options.settings.getOrchestration(),
      this.orchestrationError
    )
    if (next.effective) this.orchestrationError = undefined
    const changed = next.effective !== this.orchestration.effective
    this.orchestration = next
    this.options.info.orchestration = next.effective
    if (!changed) return
    this.localAgent.broadcastAgentInfo()
    this.relayAgent?.broadcastAgentInfo()
    this.options.log(
      next.effective ? 'orchestration service is reachable' : 'orchestration service is unavailable'
    )
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
          const host = this.options.config.local.bindHost
          this.options.log(
            `local WebSocket listening on ws://${formatHost(host)}:${this.options.config.local.port}/ws`
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
      this.options.harness.configured &&
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

  private harnessMutation(): PanelHarnessMutationResponse {
    return {
      harnesses: harnessList(this.options.harness),
      harness: harnessState(this.options.harness),
    }
  }

  private async onHarnessChanged(): Promise<void> {
    this.localAgent.reset()
    this.relayAgent?.reset()
    this.stopPushMonitor()
    await this.refreshHarnessInfo()
    this.syncPushMonitor()
    this.options.log(
      this.options.harness.configured
        ? `harness connection is active: ${this.options.harness.active?.label ?? 'OpenCode'}`
        : 'no harness connection is configured'
    )
  }

  private async refreshHarnessInfo(): Promise<void> {
    const probe = await this.options.harness.probe(3_000)
    this.options.info.opencodeVersion = probe.ok ? probe.version : undefined
    this.localAgent.broadcastAgentInfo()
    this.relayAgent?.broadcastAgentInfo()
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

function formatHost(host: string): string {
  return host.includes(':') && !host.startsWith('[') ? `[${host}]` : host
}

async function harnessCall<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  } catch (cause) {
    if (cause instanceof HarnessValidationError) {
      throw new PanelControlError(400, cause.code, cause.message)
    }
    throw cause
  }
}
