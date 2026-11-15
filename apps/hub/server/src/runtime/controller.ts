import {
  ENROLLMENT_GRANT_TTL_SECONDS,
  HARNESS_PAIRING_CODE_PREFIX,
  PAIRING_CODE_PREFIX,
  PROTOCOL_VERSION,
  buildPairingUrl,
  createRelayGrant,
  encodeHarnessPairingCode,
  encodePairingCode,
  type HarnessPairingPayload,
} from '@clara/shared-types'
import { installLabel, validateKind, validateOpencodeUrl } from '@clara/adapter-install'
import type {
  AdapterInstallMethod,
  AdapterInstallOffer,
  AdapterInstallOfferInput,
  AgentInfo,
  PanelConfigInfo,
  PanelConfigUpdate,
  PanelControls,
  PanelDevicePairingMutationResponse,
  PanelFeatureControl,
  PanelHarnessMutationResponse,
  PanelHarnessPairingMutationResponse,
  PanelHarnessSetupMode,
  PanelHarnessTestResult,
  PanelInstallManifest,
  PanelOrchestrationControl,
  PanelRelayMutationResponse,
  PanelRelayUpdate,
  PanelSyncUpdate,
} from '@clara/shared-types'
import { baseURL } from '@clara/service-control'
import type { WebSocket } from 'ws'
import { Agent } from '../agent.ts'
import { createApiApp } from '../api/app.ts'
import type { ApiApp, PanelEndpoint } from '../api/context.ts'
import {
  createRelayRoom,
  DEFAULT_ADAPTER_REGISTRY_URL,
  defaultPairingBaseUrl,
  normalizeAdapterRegistryUrl,
  normalizePairingBaseUrl,
  normalizeRelayUrl,
  readRelayTarget,
  saveAdapterRegistryUrl,
  savePairingBaseUrl,
  saveRelayRoom,
  saveRelayTarget,
  type RelayConfig,
  type ServerConfig,
} from '../config.ts'
import type { HarnessManager } from '../harness/manager.ts'
import { HarnessValidationError } from '../harness/types.ts'
import { broadcast, LocalTransport } from '../local-server.ts'
import { PanelControlError } from '../panel/controls.ts'
import { harnessList, harnessState, toPanelHarnessTest } from '../panel/harness.ts'
import type { InstallService } from '../panel/install-service.ts'
import { createPairingPayload, pairingLinkBase, relayWsUrl } from '../pairing.ts'
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
import { DeviceStoreError, type DeviceInfo, type DeviceStore } from '../store/devices.ts'
import {
  forgetRelayCredentials,
  saveRelayCredentials,
  type RelayCredentials,
} from '../store/relay.ts'
import type { SecretKeyInfo } from '../store/secret-key.ts'
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
  install?: InstallService
  sync?: ClientStorageStore
  push?: PushService
  pushError?: string
  devices: DeviceStore
  startedAt: number
  apiToken: string
  secretKey?: SecretKeyInfo
  /** The live loopback panel listener, or undefined while it is off. */
  panel?: () => PanelEndpoint | undefined
  /** A panel edit replaced the target, so a managed deployment is now stale. */
  onRelayTargetChanged?: () => void
  /** The local listener started, stopped, or bound a different port. */
  onLocalEndpointChange?: () => void
  log: (message: string, detail?: unknown) => void
}

function adapterSessions(harness: HarnessManager) {
  return {
    pairingToken: (id: string) => harness.pairingToken(id),
    credential: (id: string) => harness.credential(id),
    enroll: (
      action: Parameters<HarnessManager['enrollAdapter']>[0],
      pairToken: string,
      transport: Parameters<HarnessManager['enrollAdapter']>[2]
    ) => harness.enrollAdapter(action, pairToken, transport),
    setLive: (
      harnessId: string,
      fetch: (request: Request) => Promise<Response>,
      transport: Parameters<HarnessManager['enrollAdapter']>[2]
    ) => harness.setLive(harnessId, fetch, transport),
    clearLive: (harnessId: string, fetch?: (request: Request) => Promise<Response>) =>
      harness.clearLive(harnessId, fetch),
  }
}

const FEATURE_ORDER: FeatureName[] = ['opencode', 'local', 'relay', 'push']

const RELAY_TOKENS_MISSING =
  'The relay URL is saved, but the hub token is missing. Save it in the Relay card or the environment.'

/** A relay is only usable when its URL and hub token are present. */
function relayUsable(relay: RelayConfig | undefined): relay is RelayConfig {
  return Boolean(relay?.url && relay.agentToken)
}

/** The Docker network only resolves for a hub that runs as a container. */
function isContainerized(): boolean {
  const value = process.env.CLARA_SERVER_CONTAINER?.trim().toLowerCase()
  return value === '1' || value === 'true' || value === 'yes'
}

/**
 * Owns the lifecycle of every outbound transport. Persisted settings are the
 * desired state; the effective state can only be true when the process is not
 * stopped and the transport actually started.
 */
export class RuntimeController {
  private readonly options: ControllerOptions
  private readonly localSockets = new Set<WebSocket>()
  private readonly api: ApiApp
  private readonly localAgent: Agent
  private relayAgent?: Agent
  private relayClient?: RelayClient
  private readonly localTransport: LocalTransport
  private readonly pushMonitor?: PushMonitor
  private pushMonitorRunning = false
  private readonly errors = new Map<FeatureName, string>()
  private readonly trafficMeter: TrafficMeter
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

    this.api = createApiApp(
      {
        harness: options.harness,
        info: options.info,
        startedAt: options.startedAt,
        canAccess: () => this.canProxy(),
        sessionCount: () => this.localAgent.sessionCount,
        createAdapterPairing: (input) => this.createAdapterPairing(input),
        adapterManifest: (kind) => this.adapterManifest(kind),
        ...(options.panel ? { panel: options.panel } : {}),
        log: options.log,
      },
      { token: options.apiToken }
    )

    this.localAgent = new Agent({
      api: this.api,
      devices: options.devices,
      info: options.info,
      send: (frame) => broadcast(this.localSockets, frame),
      push: options.push,
      sync: options.sync,
      traffic: this.trafficMeter,
      adapters: adapterSessions(options.harness),
      transport: 'local',
      policy: {
        canPush: () => this.canPush(),
        canSync: () => this.canSync(),
      },
      log: options.log,
    })

    if (config.relay) {
      if (relayUsable(config.relay)) this.createRelayTransport(config.relay)
      else this.errors.set('relay', RELAY_TOKENS_MISSING)
    }

    this.localTransport = new LocalTransport({
      host: config.local.bindHost,
      port: config.local.port,
      agent: this.localAgent,
      api: this.api,
      sockets: this.localSockets,
      onBound: (port) => {
        this.options.config.local.port = port
        this.options.onLocalEndpointChange?.()
      },
      log: options.log,
    })

    if (options.push) {
      this.pushMonitor = new PushMonitor({
        harness: options.harness,
        push: options.push,
        isDeskActive: () =>
          this.localAgent.deskHoldActive() || (this.relayAgent?.deskHoldActive() ?? false),
        suppressForOrchestratorClients: (session) =>
          this.orchestration.effective && session.metadata?.automation === true,
        log: options.log,
      })
    }

    this.harnessUnsubscribe = options.harness.subscribe(() => this.onHarnessChanged())
  }

  /**
   * Replace the outbound relay target without restarting the hub process. The
   * panel's Cloudflare deployment uses this after it saves a new relay URL,
   * room, and hub token.
   */
  applyRelayConfig(relay?: RelayConfig): void {
    this.relayClient?.close()
    this.relayAgent?.close()
    this.relayClient = undefined
    this.relayAgent = undefined
    this.errors.delete('relay')

    this.options.config.relay = relay
    this.options.info.room = relay?.room

    const next = relayUsable(relay) ? this.createRelayTransport(relay) : undefined
    if (relay && !relayUsable(relay)) this.errors.set('relay', RELAY_TOKENS_MISSING)
    const shouldRun =
      next !== undefined &&
      this.options.settings.getFeature('relay') &&
      !this.options.settings.getStopped()
    if (shouldRun) next.client.start()

    this.localAgent.broadcastAgentInfo()
    next?.agent.broadcastAgentInfo()
    this.options.log(relay ? `relay target updated (${relay.url})` : 'relay target removed')
  }

  private createRelayTransport(relay: RelayConfig): {
    agent: Agent
    client: RelayClient
  } {
    const options = this.options
    const agent = new Agent({
      api: this.api,
      devices: options.devices,
      info: options.info,
      send: (frame) => this.relayClient?.send(frame),
      push: options.push,
      sync: options.sync,
      traffic: this.trafficMeter,
      adapters: adapterSessions(options.harness),
      transport: 'relay',
      policy: {
        canPush: () => this.canPush(),
        canSync: () => this.canSync(),
      },
      log: options.log,
    })
    this.relayAgent = agent
    const client = new RelayClient({
      url: relay.url,
      room: relay.room,
      agentToken: relay.agentToken,
      agent,
      log: options.log,
      onStatus: (status) => this.logRelayStatus(status),
    })
    this.relayClient = client
    return { agent, client }
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

  /** The bound port, or undefined when the local listener is not running. */
  get localPort(): number | undefined {
    return this.localTransport.active ? this.localTransport.port : undefined
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

  /** Change only the panel-facing name; the enrolled label stays immutable. */
  setDeviceAlias(
    id: string,
    alias: string | null
  ): { id: string; alias: string | null } | undefined {
    const device = this.options.devices.setAlias(id, alias)
    if (!device) return undefined
    this.options.log(`device alias updated (${id})`)
    return { id: device.id, alias: device.alias ?? null }
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

  /** Delete a revoked device record and any push routes still tied to it. */
  purgeDevice(id: string): DeviceInfo | undefined {
    let device: DeviceInfo | undefined
    try {
      device = this.options.devices.purgeDevice(id)
    } catch (cause) {
      if (cause instanceof DeviceStoreError) {
        throw new PanelControlError(409, cause.code, cause.message)
      }
      throw cause
    }
    if (!device) return undefined
    this.localAgent.abortDevice(id)
    this.relayAgent?.abortDevice(id)
    this.options.push?.removeByDevice(id)
    this.options.log(`device record deleted (${id})`)
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
      monitoring: { enabled: settings.monitoring },
      sync: { ...settings.sync },
      orchestration: this.orchestration,
      install: { enabled: settings.install },
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
      this.options.log(
        'connections stopped by an admin setting; only the panel and database are running'
      )
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

  /**
   * Monitoring is a panel concern, not a transport: it stays switchable while
   * connections are off. Turning it off discards the window so no stale
   * numbers survive the decision.
   */
  async setMonitoring(enabled: boolean): Promise<PanelControls> {
    this.options.settings.setMonitoring(enabled)
    this.trafficMeter.setEnabled(enabled)
    this.options.log(enabled ? 'traffic monitoring enabled' : 'traffic monitoring disabled')
    return this.controls()
  }

  /**
   * Orchestration is the master switch for the local service and its
   * client-facing feature. It is independent of the transport stop flag.
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
  async setInstall(enabled: boolean): Promise<PanelControls> {
    if (this.options.settings.getInstall() === enabled) return this.controls()
    this.options.settings.setInstall(enabled)
    this.options.log(enabled ? 'adapter setup enabled' : 'adapter setup disabled')
    return this.controls()
  }

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
    const registryProvided = Object.prototype.hasOwnProperty.call(update, 'adapterRegistryUrl')
    const vapidProvided = Object.prototype.hasOwnProperty.call(update, 'vapidSubject')

    let pairingBaseUrl: string | undefined
    if (pairingProvided) {
      if (config.sources.pairingBaseUrl === 'env') {
        throw new PanelControlError(
          409,
          'env_override',
          'CLARA_PAIRING_BASE_URL is set. Remove it and restart the hub service to edit the Web URL here.'
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

    let adapterRegistryUrl: string | undefined
    if (registryProvided) {
      if (config.sources.adapterRegistryUrl === 'env') {
        throw new PanelControlError(
          409,
          'env_override',
          'CLARA_ADAPTER_REGISTRY_URL is set. Remove it and restart the hub service to edit the registry here.'
        )
      }
      const value = update.adapterRegistryUrl
      if (value !== null && value !== undefined && value.trim()) {
        try {
          adapterRegistryUrl = normalizeAdapterRegistryUrl(value)
        } catch (cause) {
          throw new PanelControlError(400, 'invalid_adapter_registry_url', errorMessage(cause))
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
          'CLARA_VAPID_SUBJECT is set. Remove it and restart the hub service to edit the VAPID contact here.'
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
    if (registryProvided) {
      saveAdapterRegistryUrl(config.configPath, adapterRegistryUrl)
      config.adapterRegistryUrl = adapterRegistryUrl ?? DEFAULT_ADAPTER_REGISTRY_URL
      config.sources.adapterRegistryUrl = adapterRegistryUrl ? 'file' : 'default'
    }
    if (writeVapidSubject) {
      saveVapidSubject(config.configDir, nextVapidSubject)
      this.options.push?.setSubject(nextVapidSubject ?? DEFAULT_VAPID_SUBJECT)
    }

    return panelConfigInfo(config)
  }

  async updateRelay(update: PanelRelayUpdate): Promise<PanelRelayMutationResponse> {
    const { config } = this.options
    const sources = config.sources
    const envUrl = sources.relayUrl === 'env' ? config.relay?.url : undefined
    const envRoom = sources.relayRoom === 'env' ? config.relay?.room : undefined
    const envAgentToken = sources.agentToken === 'env' ? config.relay?.agentToken : undefined

    if (envUrl && update.url !== undefined) {
      throw new PanelControlError(
        409,
        'env_override',
        'CLARA_RELAY_URL is set. Remove it and restart the hub service to edit the relay URL here.'
      )
    }
    if (envAgentToken && update.agentToken !== undefined) {
      throw new PanelControlError(
        409,
        'env_override',
        'CLARA_AGENT_TOKEN is set. Remove it and restart the hub service to edit the hub token here.'
      )
    }
    let url = envUrl
    if (!envUrl) {
      if (update.url === undefined) {
        throw new PanelControlError(400, 'relay_url_required', 'Enter a relay URL')
      }
      try {
        url = normalizeRelayUrl(update.url)
      } catch (cause) {
        throw new PanelControlError(400, 'invalid_relay_url', errorMessage(cause))
      }
    }
    if (!url) throw new PanelControlError(400, 'relay_url_required', 'Enter a relay URL')

    const agentToken =
      envAgentToken ?? tokenValue(update.agentToken, config.relay?.agentToken, 'hub token')
    if (!agentToken) {
      throw new PanelControlError(
        400,
        'relay_tokens_required',
        'Enter the relay hub token, or remove the relay URL. The hub cannot connect without it.'
      )
    }

    const room = envRoom ?? config.relay?.room ?? createRelayRoom()
    const roomSource = envRoom ? 'env' : config.relay?.room ? sources.relayRoom : 'generated'
    const stored = readRelayTarget(config.configPath)
    saveRelayTarget(config.configPath, {
      ...(envUrl ? (stored?.url ? { url: stored.url } : {}) : { url }),
      ...(envRoom ? (stored?.room ? { room: stored.room } : {}) : { room }),
    })
    await this.writeRelayCredentials({
      ...(envAgentToken ? {} : { agentToken }),
    })

    config.relay = { url, room, agentToken }
    config.sources.relayUrl = envUrl ? 'env' : 'file'
    config.sources.relayRoom = roomSource
    config.sources.agentToken = envAgentToken ? 'env' : 'file'
    this.applyRelayConfig(config.relay)
    this.options.onRelayTargetChanged?.()
    this.options.log('relay target saved from the panel')
    return { config: panelConfigInfo(config) }
  }

  async clearRelay(): Promise<PanelRelayMutationResponse> {
    const { config } = this.options
    const sources = config.sources
    const envUrl = sources.relayUrl === 'env' ? config.relay?.url : undefined
    const envRoom = sources.relayRoom === 'env' ? config.relay?.room : undefined
    const envAgentToken = sources.agentToken === 'env' ? config.relay?.agentToken : undefined
    if (envUrl && !envAgentToken) {
      throw new PanelControlError(
        409,
        'env_relay_incomplete',
        'The relay URL comes from CLARA_RELAY_URL. Set CLARA_AGENT_TOKEN, or remove the relay URL, before clearing the panel relay.'
      )
    }

    const stored = readRelayTarget(config.configPath)
    forgetRelayCredentials(config.configDir)
    if (!envUrl) {
      saveRelayTarget(config.configPath, undefined)
      config.relay = undefined
      config.sources.relayUrl = 'none'
      config.sources.relayRoom = 'none'
      config.sources.agentToken = 'none'
      this.applyRelayConfig(undefined)
      this.options.onRelayTargetChanged?.()
      this.options.log('relay target cleared from the panel')
      return { config: panelConfigInfo(config) }
    }

    const room = envRoom ?? config.relay?.room
    if (!room) throw new PanelControlError(409, 'relay_room_missing', 'The relay room is missing')
    if (!envAgentToken) {
      throw new PanelControlError(
        409,
        'env_relay_incomplete',
        'Set CLARA_AGENT_TOKEN in the environment before clearing the panel relay.'
      )
    }
    saveRelayTarget(config.configPath, {
      ...(envRoom ? (stored?.room ? { room: stored.room } : {}) : { room }),
    })
    config.relay = {
      url: envUrl,
      room,
      agentToken: envAgentToken,
    }
    config.sources.relayRoom = envRoom ? 'env' : stored?.room ? 'file' : 'generated'
    this.applyRelayConfig(config.relay)
    this.options.onRelayTargetChanged?.()
    this.options.log('panel relay values cleared; the environment relay remains')
    return { config: panelConfigInfo(config) }
  }

  async regenerateRelayRoom(): Promise<PanelRelayMutationResponse> {
    const { config } = this.options
    if (config.sources.relayRoom === 'env') {
      throw new PanelControlError(
        409,
        'env_override',
        'CLARA_RELAY_ROOM is set. Remove it and restart the hub service to regenerate the room here.'
      )
    }
    if (!config.relay) {
      throw new PanelControlError(409, 'relay_not_configured', 'Configure a relay first')
    }

    const room = createRelayRoom()
    saveRelayRoom(config.configPath, room)
    config.relay.room = room
    config.sources.relayRoom = 'generated'
    this.applyRelayConfig(config.relay)
    this.options.log('relay room regenerated from the panel')
    return { config: panelConfigInfo(config) }
  }

  private async writeRelayCredentials(credentials: RelayCredentials): Promise<void> {
    const secretKey = this.options.secretKey
    if (!secretKey) {
      throw new PanelControlError(
        503,
        'relay_store_unavailable',
        'The hub secret key is unavailable, so the relay token cannot be saved'
      )
    }
    await saveRelayCredentials(this.options.config.configDir, secretKey, credentials)
  }

  async createDevicePairing(value: unknown): Promise<PanelDevicePairingMutationResponse> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new PanelControlError(400, 'invalid_body', 'Use a JSON object')
    }
    const record = value as Record<string, unknown>
    if ('localOnly' in record && typeof record.localOnly !== 'boolean') {
      throw new PanelControlError(400, 'invalid_local_only', 'localOnly must be a boolean')
    }
    const localOnly = record.localOnly === true
    const { config } = this.options
    const relayIncomplete = Boolean(config.relay && !relayUsable(config.relay))
    const useLocal = localOnly || relayIncomplete
    if (!localOnly && relayIncomplete) {
      this.options.log('the relay hub token is missing; created a local browser pairing')
    }
    this.options.devices.pruneExpiredTokens()
    const payload = await createPairingPayload(config, this.options.devices, {
      noRelay: useLocal,
    })
    const link = buildPairingUrl(
      pairingLinkBase(config.pairingBaseUrl, config.local.host, { noRelay: useLocal }),
      payload
    )
    const code = `${PAIRING_CODE_PREFIX}${encodePairingCode(payload)}`
    return {
      pairing: {
        id: payload.enrollId,
        code,
        link,
        wsUrl: payload.wsUrl,
        room: payload.room,
        transport: payload.room === 'local' ? 'local' : 'relay',
        fingerprint: payload.fingerprint,
        expiresAt: new Date(payload.expiresAt).toISOString(),
      },
    }
  }

  cancelDevicePairing(id: string): void {
    this.options.devices.cancelPairingToken(id)
  }

  async createHarnessPairing(value: unknown): Promise<PanelHarnessPairingMutationResponse> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new PanelControlError(400, 'invalid_body', 'Use a JSON object')
    }
    const record = value as Record<string, unknown>
    const kind = typeof record.kind === 'string' ? record.kind.trim() : ''
    const label = typeof record.label === 'string' ? record.label.trim() : ''
    if (!kind) throw new PanelControlError(400, 'invalid_kind', 'Choose a harness type')
    const requestedTransport =
      record.transport === 'local' || record.transport === 'relay' || record.transport === 'docker'
        ? record.transport
        : 'local'
    const requestedWsUrl = typeof record.wsUrl === 'string' ? record.wsUrl.trim() : ''
    if (requestedWsUrl && !/^wss?:\/\//i.test(requestedWsUrl)) {
      throw new PanelControlError(
        400,
        'invalid_ws_url',
        'The WebSocket URL must start with ws:// or wss://'
      )
    }
    if (requestedTransport === 'relay' && requestedWsUrl) {
      throw new PanelControlError(
        400,
        'relay_url_fixed',
        'A relay pairing always uses the configured relay URL.'
      )
    }
    const relay = relayUsable(this.options.config.relay) ? this.options.config.relay : undefined
    if (requestedTransport === 'relay' && !relay) {
      throw new PanelControlError(
        400,
        'relay_tokens_required',
        'Save the relay hub token in the Relay card before creating a relay pairing.'
      )
    }
    // A container cannot reach the hub's loopback listener, so a Docker target
    // on a host-process hub needs the relay, matching transportFor().
    const transport =
      requestedTransport === 'docker' && !isContainerized() ? 'relay' : requestedTransport
    if (transport === 'relay' && !relay) {
      throw new PanelControlError(
        400,
        'relay_required',
        'Configure the relay before creating a container pairing on this hub.'
      )
    }
    const pairing = await harnessCall(() =>
      this.options.harness.createPairing({ kind, label: label || kind })
    )
    const localPort = this.options.config.local.port
    const room = transport === 'relay' && relay ? relay.room : 'local'
    const override = transport === 'relay' ? '' : requestedWsUrl
    const wsUrl =
      transport === 'relay' && relay
        ? relayWsUrl(relay.url, room)
        : transport === 'docker'
          ? override || `ws://server:${localPort}/ws`
          : override || `ws://${this.options.config.local.host}:${localPort}/ws`
    const grant =
      transport === 'relay' && relay
        ? await createRelayGrant({
            room: relay.room,
            id: pairing.id,
            agentToken: relay.agentToken,
            ttlSeconds: ENROLLMENT_GRANT_TTL_SECONDS,
            kind: 'adapter',
          })
        : undefined
    const payload: HarnessPairingPayload = {
      v: PROTOCOL_VERSION,
      role: 'adapter' as const,
      kind,
      wsUrl,
      room,
      enrollId: pairing.id,
      enrollToken: pairing.token,
      ...(grant ? { grant: grant.grant } : {}),
      fingerprint: pairing.fingerprint,
      expiresAt: pairing.expiresAt,
    }
    const code = `${HARNESS_PAIRING_CODE_PREFIX}${encodeHarnessPairingCode(payload)}`
    return {
      pairing: {
        id: pairing.id,
        kind,
        label: label || kind,
        transport,
        code,
        wsUrl,
        room,
        fingerprint: pairing.fingerprint,
        expiresAt: new Date(pairing.expiresAt).toISOString(),
        createdAt: new Date(pairing.createdAt).toISOString(),
      },
    }
  }

  /**
   * Issue the pairing and the install command for one adapter kind. The caller
   * runs the command on the machine that owns the harness; the hub only issues.
   * The transport can be overridden when the installer will run somewhere that
   * cannot reach the hub's configured local address.
   */
  async createAdapterPairing(input: AdapterInstallOfferInput): Promise<AdapterInstallOffer> {
    const install = this.options.install
    if (!install) {
      throw new PanelControlError(503, 'install_unavailable', 'Adapter setup is not available.')
    }
    const kind = validateKind(input.kind)
    const opencodeUrl = validateOpencodeUrl(input.opencodeUrl)
    const transport = input.transport ?? this.transportForMethod(input.method)
    const resolved = await install.manifest(kind)
    const pairing = await this.createHarnessPairing({
      kind,
      label: installLabel(kind),
      transport,
      ...(input.wsUrl ? { wsUrl: input.wsUrl } : {}),
    })
    const command = install.command(resolved.manifest, pairing.pairing.code, opencodeUrl)
    return {
      pairing: pairing.pairing,
      manifest: resolved.manifest,
      command,
      deepLink: install.deepLink(pairing.pairing.code, kind),
    }
  }

  async adapterManifest(kind: string): Promise<PanelInstallManifest> {
    const install = this.options.install
    if (!install) {
      throw new PanelControlError(503, 'install_unavailable', 'Adapter setup is not available.')
    }
    const resolved = await install.manifest(validateKind(kind))
    return resolved.manifest
  }

  private transportForMethod(method: AdapterInstallMethod | undefined): PanelHarnessSetupMode {
    const relay = relayUsable(this.options.config.relay) ? this.options.config.relay : undefined
    if (method === 'ssh') {
      if (!relay) {
        throw new PanelControlError(
          400,
          'relay_required',
          'Configure the relay before pairing an adapter on another machine.'
        )
      }
      return 'relay'
    }
    if (method === 'docker') return 'docker'
    if (method === 'local') return 'local'
    if (relay) return 'relay'
    return 'local'
  }

  async cancelHarnessPairing(id: string): Promise<void> {
    this.options.harness.cancelPairing(id)
  }

  async testHarness(id: string): Promise<PanelHarnessTestResult> {
    const result = await harnessCall(() => this.options.harness.probeConnection(id))
    this.options.harness.recordTest(id, result.ok, result.ok ? undefined : result.message)
    return toPanelHarnessTest(result)
  }

  async deleteHarness(id: string): Promise<PanelHarnessMutationResponse> {
    await harnessCall(async () => this.options.harness.remove(id))
    return this.harnessMutation()
  }

  async forgetHarness(id: string): Promise<PanelHarnessMutationResponse> {
    await harnessCall(async () => this.options.harness.forget(id))
    return this.harnessMutation()
  }

  async setStopped(stopped: boolean): Promise<PanelControls> {
    if (this.options.settings.getStopped() === stopped) return this.controls()
    this.options.settings.setStopped(stopped)

    if (stopped) {
      this.errors.clear()
      this.options.log('connections stopped by an admin setting')
      await this.stopLocal()
      this.relayClient?.close()
      this.stopPushMonitor()
      this.localAgent.reset()
      this.relayAgent?.reset()
      return this.controls()
    }

    this.options.log('connections started by an admin setting')
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
            `local WebSocket listening on ws://${formatHost(host)}:${this.localTransport.port}/ws`
          )
        } else {
          await this.stopLocal('local transport disabled by an admin setting')
          this.localAgent.reset()
          this.options.onLocalEndpointChange?.()
        }
        return
      case 'relay':
        if (!enabled) {
          this.relayClient?.close()
          return
        }
        if (!this.relayConfigured()) {
          if (this.options.config.relay) this.errors.set('relay', RELAY_TOKENS_MISSING)
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
    return relayUsable(this.options.config.relay)
  }

  private harnessMutation(): PanelHarnessMutationResponse {
    const control = this.controls().features.find((feature) => feature.name === 'opencode')
    return {
      harnesses: harnessList(this.options.harness),
      harness: harnessState(this.options.harness, control ?? { desired: false, effective: false }),
    }
  }

  private async onHarnessChanged(): Promise<void> {
    // Adapters own their live sessions. Resetting the agents here would drop
    // the enrollment session before the hub can answer it, and would tear down
    // the credential session the moment it registers.
    this.pushMonitor?.sync()
    await this.refreshHarnessInfo()
    this.syncPushMonitor()
    const connections = this.options.harness.list()
    this.options.log(
      connections.length > 0
        ? `paired harnesses: ${connections.length} (${connections.filter((item) => item.online).length} online)`
        : 'no harness connection is configured'
    )
  }

  private async refreshHarnessInfo(): Promise<void> {
    this.options.info.opencodeVersion = this.options.harness
      .list()
      .find((connection) => connection.online && connection.harnessVersion)?.harnessVersion
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
    super('Connections are off. Go online before changing features.')
    this.name = 'AgentStoppedError'
  }
}

function tokenValue(
  value: string | undefined,
  current: string | undefined,
  label: string
): string | undefined {
  if (value === undefined) return current
  const trimmed = value.trim()
  if (!trimmed) {
    throw new PanelControlError(400, 'invalid_relay_token', `The relay ${label} cannot be empty`)
  }
  // Both tokens travel as `clara.auth.*` subprotocol values, so a comma breaks
  // the header and short values are guessable. The relay rejects the same shape.
  if (trimmed.length < 32 || trimmed.length > 512 || /[\s,]/.test(trimmed)) {
    throw new PanelControlError(
      400,
      'invalid_relay_token',
      'The relay token must be at least 32 characters with no spaces or commas. Use the generated value or `openssl rand -base64 32`.'
    )
  }
  return trimmed
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
