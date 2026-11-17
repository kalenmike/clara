/**
 * Read-only DTOs for the hub's loopback panel.
 *
 * These types are deliberately separate from the relay wire frames in
 * `frames.ts`, `actions.ts`, and `states.ts`. The panel is served by the home
 * agent on a loopback listener; it never travels through the relay.
 */

import type { HarnessHost, HarnessInstallMethod, HostResourceMetrics } from './host.ts'

export const PANEL_API_VERSION = 15

export type PanelValueSource =
  'env' | 'file' | 'database' | 'default' | 'generated' | 'runtime' | 'none'

export type PanelValue<T> = {
  value: T
  source: PanelValueSource
}

export type PanelHealth = 'ok' | 'warn' | 'error' | 'missing'

export type PanelDeviceClass = 'desktop' | 'mobile'

export type PanelTransport = 'local' | 'relay'

/**
 * `enroll` is a one-time pairing session that has no device yet. `adapter` is
 * a live harness adapter session, shown on the Harness view rather than with
 * browser clients.
 */
export type PanelClientKind = 'device' | 'enroll' | 'adapter'

export type PanelRelayStatus =
  'disabled' | 'stopped' | 'connecting' | 'online' | 'reconnecting' | 'offline'

export type PanelAgentInfo = {
  version: string
  protocol: number
  startedAt: string
  uptimeMs: number
  pid: number
  node: string
  platform: string
  arch: string
  memoryRssBytes: number
  configPath: string
  configDir: string
  pairedDevices: number
  stopped: boolean
  /** True when this hub service runs in a container. */
  container: boolean
}

/** Which interfaces the hub's local WebSocket listener binds. */
export type LocalAccessMode = 'loopback' | 'docker' | 'lan' | 'custom'

/** A concrete address an adapter or client can dial to reach the hub. */
export type PanelLocalAddress = {
  /** Loopback, a local Docker bridge, or a local network interface. */
  scope: 'loopback' | 'docker' | 'lan'
  host: string
  url: string
}

export type PanelConfigInfo = {
  localHost: PanelValue<string>
  localAccess?: PanelValue<LocalAccessMode>
  localBindHost?: PanelValue<string>
  localPort: PanelValue<number>
  relayUrl: PanelValue<string | null>
  relayRoom: PanelValue<string | null>
  pairingBaseUrl: PanelValue<string>
  adapterRegistryUrl: PanelValue<string>
  vapidSubject: PanelValue<string>
}

export type PanelConfigUpdate = {
  localAccess?: LocalAccessMode
  localBindHost?: string | null
  pairingBaseUrl?: string | null
  adapterRegistryUrl?: string | null
  vapidSubject?: string | null
}

export type PanelConfigMutationResponse = {
  config: PanelConfigInfo
}

export type PanelAuthInfo = {
  username: string
  role: 'superadmin'
}

export type PanelAuthStatus =
  | {
      authenticated: false
      setupRequired: boolean
      /** A host-supplied token gates the setup form; local setup does not need one. */
      setupTokenRequired: boolean
      resetPending: boolean
    }
  | { authenticated: true; user: PanelAuthInfo }

export type PanelLoginUpdate = {
  username: string
  password: string
  /** Keep the session across app restarts until sign-out or revocation. */
  remember?: boolean
}

export type PanelSetupUpdate = {
  /** Required only when the hub is started with a host setup token. */
  token?: string
  username: string
  password: string
  /** Keep the session across app restarts until sign-out or revocation. */
  remember?: boolean
}

export type PanelPasswordUpdate = {
  currentPassword: string
  newPassword: string
}

export type PanelHarnessKind = string
export type PanelHarnessTransport = 'local' | 'relay'
export type PanelHarnessSetupMode = 'local' | 'docker' | 'relay'

export type PanelHarness = {
  id: string
  harnessId: string
  kind: PanelHarnessKind
  label: string
  transport: PanelHarnessTransport
  online: boolean
  /** The machine or container the adapter reports, with the install method. */
  host?: HarnessHost
  /** Fingerprint of the paired adapter credential. */
  fingerprint?: string
  adapterVersion?: string
  /** When the installed adapter recorded its install, when it reports one. */
  adapterInstalledAt?: string
  protocolVersion?: number
  harnessVersion?: string
  capabilities?: Record<string, unknown>
  /** Live host sample; absent while the adapter is offline or does not report it. */
  resources?: HostResourceMetrics
  credentialConfigured: boolean
  /** Set when the connection was forgotten; only a permanent delete remains. */
  forgottenAt?: string
  lastTestAt?: string
  lastTestOk?: boolean
  lastTestError?: string
  lastSeenAt?: string
  createdAt: string
  updatedAt: string
}

export type PanelHarnessPairing = {
  id: string
  kind: PanelHarnessKind
  label: string
  code: string
  transport: PanelHarnessSetupMode
  /** Where the adapter will run, when the issuing flow named it. */
  installMethod?: HarnessInstallMethod
  wsUrl: string
  room: string
  fingerprint: string
  expiresAt: string
  createdAt: string
}

export type PanelHarnessPairingMutationResponse = {
  pairing: PanelHarnessPairing
}

export type PanelHarnessPairingList = PanelHarnessPairing[]

export type PanelHarnessState = {
  configured: boolean
  paired: number
  online: number
  desired: boolean
  effective: boolean
  error?: string
}

export type PanelHarnessTestResult = {
  ok: boolean
  code: string
  message?: string
  version?: string
  status?: number
  latencyMs: number
  checkedAt: string
}

export type PanelHarnessMutationResponse = {
  harnesses: PanelHarness[]
  harness: PanelHarnessState
}

/** The version pair the hub accepted for a remote adapter update. */
export type PanelHarnessUpdateResult = {
  from: string
  to: string
}

/** One downloadable adapter build in a registry manifest. */
export type PanelInstallArtifact = {
  url: string
  sha256: string
  size?: number
}

/**
 * The registry manifest for one harness. The hub reads it to learn the latest
 * version and the install script; it never downloads the adapter itself.
 */
export type PanelInstallManifest = {
  schemaVersion: 1
  harness: string
  version: string
  publishedAt?: string
  install: string
  installSha256: string
  artifacts: Record<string, PanelInstallArtifact>
}

export type PanelInstallRegistryEntry = {
  kind: string
  manifestUrl: string
  ok: boolean
  checkedAt: string
  manifest?: PanelInstallManifest
  /** The version the paired adapter reports, when one has connected. */
  installedVersion?: string
  error?: string
}

export type PanelInstallRegistry = {
  baseUrl: string
  source: PanelValueSource
  entries: PanelInstallRegistryEntry[]
}

export type PanelInstallSshHost = {
  /** The Host alias from ~/.ssh/config, or the entered hostname. */
  alias: string
  hostname: string
  user?: string
  port?: number
}

export type PanelInstallSshTargets = {
  available: boolean
  reason?: string
  hosts: PanelInstallSshHost[]
}

export type PanelInstallDockerContainer = {
  id: string
  name: string
  image: string
  state: string
  project?: string
  service?: string
  /** Default gateways for the container's Docker networks. */
  gateways?: string[]
}

export type PanelInstallDockerTargets = {
  available: boolean
  reason?: string
  containers: PanelInstallDockerContainer[]
}

export type PanelInstallInfo = {
  enabled: boolean
  available: boolean
  reason?: string
  registry: PanelInstallRegistry
}

/**
 * A one-time adapter pairing plus the material a browser can hand to a local
 * installer. The hub issues this; it never runs the install itself.
 */
export type AdapterInstallOffer = {
  pairing: PanelHarnessPairing
  manifest?: PanelInstallManifest
  command?: string
  deepLink: string
}

/** Where an adapter install runs. `local` is the client's own machine. */
export type AdapterInstallMethod = HarnessInstallMethod

/**
 * What the panel asks the hub to issue. `method` says where the installer will
 * run; `transport` says how the adapter reaches the hub. They usually follow
 * from the same answer but stay separate because an SSH install can still reach
 * the hub over a direct address.
 */
export type AdapterInstallOfferInput = {
  kind: string
  method?: AdapterInstallMethod
  transport?: PanelHarnessSetupMode
  /** A direct WebSocket URL; ignored for relay transport. */
  wsUrl?: string
  opencodeUrl?: string
}

/** Kept as an alias for the panel API shape. */
export type PanelInstallMethod = AdapterInstallMethod

export type PanelInstallHostInput = {
  /** Use this ~/.ssh/config alias and let ssh resolve user, host, and port. */
  alias?: string
  hostname?: string
  user?: string
  port?: number
}

export type AdapterInstallJobState = 'running' | 'succeeded' | 'failed' | 'cancelled'

export type AdapterInstallJob = {
  id: string
  kind: string
  method: AdapterInstallMethod
  target: string
  state: AdapterInstallJobState
  startedAt: string
  finishedAt?: string
  exitCode?: number
  lines: string[]
  error?: string
}

export type PanelOpenCodeInfo = {
  url: string
  passwordConfigured: boolean
  reachable: boolean
  desired: boolean
  effective: boolean
  configured: boolean
  version?: string
  latencyMs?: number
  checkedAt: string
  code:
    | 'ok'
    | 'timeout'
    | 'auth'
    | 'http'
    | 'unreachable'
    | 'offline'
    | 'disabled'
    | 'unconfigured'
    | 'unsupported'
  error?: string
}

export type PanelLocalTransport = {
  host: string
  port: number
  url: string
  /** The configured access mode, when the hub reports one. */
  access?: LocalAccessMode
  /** Every address the listener actually bound. */
  bindHosts?: string[]
  /** Concrete dialable addresses, with loopback first. */
  addresses?: PanelLocalAddress[]
  /** The Docker bridge address a local container can use, when one exists. */
  containerUrl?: string
  connections: number
  desired: boolean
  active: boolean
  effective: boolean
  error?: string
}

export type PanelCloudflareAccount = {
  id: string
  name: string
}

export type PanelCloudflareZone = {
  id: string
  name: string
}

export type PanelRelayDeploymentCustomDomain = {
  hostname: string
  zoneId: string
  domainId: string
  /** The custom hostname answered its relay health check. */
  ready: boolean
}

export type PanelRelayDeployment = {
  /** Compiled into this hub build. */
  available: boolean
  /** The relay target was created by the panel deployment flow. */
  managed: boolean
  /** The current relay configuration is owned by the environment or a file. */
  envManaged: boolean
  connected: boolean
  tokenStored: boolean
  accountId?: string
  accountName?: string
  scriptName?: string
  hostname?: string
  deployedAt?: string
  reachable?: boolean
  /** Preview/version URLs are enabled for the deployed Worker. */
  previewUrls?: boolean
  /** Attached Worker custom domain, when one was requested. */
  customDomain?: PanelRelayDeploymentCustomDomain
  /** The workers.dev host was turned off after the custom host went live. */
  disableWorkersDev?: boolean
  error?: string
}

export type PanelRelayTransport = {
  configured: boolean
  url?: string
  room?: string
  status: PanelRelayStatus
  desired: boolean
  effective: boolean
  agentTokenConfigured: boolean
  /** Where each relay value came from; absent while unconfigured. */
  urlSource?: PanelValueSource
  roomSource?: PanelValueSource
  agentTokenSource?: PanelValueSource
  /** At least one relay value comes from the environment. */
  envManaged?: boolean
  /** The panel may replace the room with a fresh random value. */
  roomRegeneratable?: boolean
  connectedSince?: string
  lastChangedAt?: string
  reconnectAttempts?: number
  lastError?: string
  /** When another hub last connected to this room; epoch milliseconds. */
  replacedAt?: number
  error?: string
  /** Present when the optional Cloudflare deployment feature is built in. */
  cloudflare?: PanelRelayDeployment
}

/**
 * Panel-managed relay edits. The room is never accepted from the panel; the hub
 * generates it and exposes a separate regeneration action.
 */
export type PanelRelayUpdate = {
  url?: string
  agentToken?: string
}

export type PanelRelayMutationResponse = {
  config: PanelConfigInfo
}

export type PanelClientInfo = {
  sid: string
  transport: PanelTransport
  kind: PanelClientKind
  deviceId?: string
  deviceLabel?: string
  /** Present on `adapter` sessions. */
  adapterId?: string
  /** Present on `adapter` sessions; the stable harness identity. */
  harnessId?: string
  deviceClass?: PanelDeviceClass
  connectedAt: string
  lastSeenAt: string
  idleMs: number
  /** Requests in flight right now. */
  requests: number
  /**
   * Lifetime counters for this session. Absent while traffic monitoring is
   * off, so an idle agent cannot be mistaken for an unused one.
   */
  bytesIn?: number
  bytesOut?: number
  requestsTotal?: number
  holdPhone: boolean
}

/** Longest custom device alias accepted by the panel. */
export const MAX_DEVICE_ALIAS_LENGTH = 64

export type PanelDeviceInfo = {
  id: string
  label: string
  /** Panel-set display name that overrides the enrolled label when present. */
  alias?: string
  fingerprint: string
  createdAt: string
  lastSeenAt?: string
  transport?: PanelTransport
  deviceClass?: PanelDeviceClass
  liveSessions: number
  revokedAt?: string
}

/**
 * A one-time browser enrollment capability created by the panel. The code is
 * returned only from the authenticated creation request, never in the
 * read-only snapshot.
 */
export type PanelDevicePairing = {
  id: string
  code: string
  link: string
  wsUrl: string
  room: string
  transport: PanelTransport
  fingerprint: string
  expiresAt: string
}

export type PanelDevicePairingMutationResponse = {
  pairing: PanelDevicePairing
}

export type PanelPushInfo = {
  enabled: boolean
  desired: boolean
  effective: boolean
  subscriptions: number
  failing: number
  /** The VAPID key pair loaded, independent of subscription storage. */
  vapidConfigured: boolean
  /** False when the subscriptions file could not be read or written. */
  storageAvailable: boolean
  /** Present when subscriptions.json could not be read or written. */
  storageError?: string
  error?: string
}

export type PanelPushStorage = {
  available: boolean
  subscriptions: number
  error?: string
}

export type PanelPushStorageMutationResponse = {
  storage: PanelPushStorage
}

export type PanelStorageKey =
  'config' | 'subscriptions' | 'vapid' | 'database' | 'setup-token' | 'secret-key'

export type PanelSyncStats = {
  namespaces: number
  entries: number
  liveEntries: number
  tombstones: number
  bytes: number
}

export type PanelStorageEntry = {
  key: PanelStorageKey
  label: string
  path: string
  exists: boolean
  readable?: boolean
  writable: boolean
  bytes?: number
  modifiedAt?: string
  mode?: string
  status: PanelHealth
  detail?: string
  schemaVersion?: number
  sync?: PanelSyncStats
}

export type PanelEvent = {
  at: string
  level: 'info' | 'warn' | 'error'
  message: string
}

export type PanelFeatureName = 'opencode' | 'local' | 'relay' | 'push'

export type PanelFeatureControl = {
  name: PanelFeatureName
  configured: boolean
  desired: boolean
  effective: boolean
  error?: string
}

export type PanelControls = {
  stopped: boolean
  features: PanelFeatureControl[]
  monitoring: PanelMonitoringControl
  sync: PanelSyncControl
  orchestration: PanelOrchestrationControl
  install: PanelInstallControl
}

export type PanelInstallControl = {
  /** Allows the panel to run the adapter install script over SSH or Docker. */
  enabled: boolean
}

export type PanelMonitoringControl = {
  enabled: boolean
}

export type PanelSyncControl = {
  enabled: boolean
  /** How often paired clients check for settings changes. */
  intervalMs: number
}

export type PanelOrchestrationState =
  'local' | 'container' | 'external' | 'stopped' | 'unresponsive' | 'foreign'

export type PanelOrchestrationControl = {
  /** Whether this hub should keep a local service running. */
  desired: boolean
  /** True while the orchestrator health endpoint answers. */
  effective: boolean
  state: PanelOrchestrationState
  url: string
  pid?: number
  error?: string
}

export type PanelFeatureUpdate = {
  feature: PanelFeatureName
  enabled: boolean
}

export type PanelAgentUpdate = {
  stopped: boolean
}

export type PanelMonitoringUpdate = {
  enabled: boolean
}

export type PanelSyncUpdate = {
  enabled: boolean
  intervalMs: number
}

export type PanelOrchestrationUpdate = {
  enabled: boolean
}

export type PanelInstallUpdate = {
  enabled: boolean
}

export type PanelMutationResponse = {
  controls: PanelControls
}

/**
 * Error counters for the traffic meter. They are named for what the hub
 * observed, never for a payload it decrypted and kept.
 */
export type PanelTrafficErrorKey =
  | 'handshake'
  | 'crypto'
  | 'orphan'
  | 'dropped'
  | 'refused'
  | 'limited'
  | 'upstream'
  | 'expired'
  | 'misrouted'

export type PanelTrafficTotals = {
  bytesIn: number
  bytesOut: number
  framesIn: number
  framesOut: number
  requests: number
  sessionsOpened: number
  sessionsClosed: number
}

export type PanelTrafficTransport = {
  bytesIn: number
  bytesOut: number
  framesIn: number
  framesOut: number
  requests: number
}

export type PanelTrafficRate = {
  /** Length of the window the rate is measured over. */
  windowMs: number
  bytesInPerSecond: number
  bytesOutPerSecond: number
  requestsPerMinute: number
  errorsPerMinute: number
}

/** One minute of traffic, oldest first. */
export type PanelTrafficSample = {
  at: string
  bytesIn: number
  bytesOut: number
  requests: number
  errors: number
}

export type PanelTrafficPeak = {
  bytesIn: number
  bytesOut: number
  requests: number
  errors: number
}

export type PanelTrafficSpike = 'bytes' | 'requests' | 'errors'

export type PanelTraffic = {
  enabled: boolean
  /** When the current measurement window started; absent while off. */
  since?: string
  windowMs: number
  /** True until the first complete minute has been measured. */
  warmup: boolean
  totals: PanelTrafficTotals
  rate: PanelTrafficRate
  errors: Record<PanelTrafficErrorKey, number>
  peak: PanelTrafficPeak
  series: PanelTrafficSample[]
  byTransport: Record<PanelTransport, PanelTrafficTransport>
  /** Signals that crossed the spike threshold on the last complete minute. */
  spike: PanelTrafficSpike[]
}

/** One agent session observed on a paired harness. */
export type PanelSessionState = 'running' | 'awaiting-input' | 'idle'

export type PanelSession = {
  id: string
  harnessID: string
  harnessLabel: string
  harnessKind: string
  title?: string
  agent?: string
  model?: string
  directory: string
  projectID?: string
  parentID?: string
  state: PanelSessionState
  archived: boolean
  snoozed: boolean
  createdAt: string
  updatedAt: string
}

/** One paired harness and whether its session lookup succeeded. */
export type PanelSessionHarness = {
  harnessID: string
  label: string
  kind: string
  online: boolean
  ok: boolean
  code?: string
  message?: string
  sessionCount: number
  runningCount: number
}

export type PanelSessionsQuery = {
  harnessID?: string
  runningOnly?: boolean
  includeArchived?: boolean
  search?: string
  /** Maximum rows requested from each harness. */
  limit?: number
}

export type PanelSessionsResponse = {
  generatedAt: string
  sessions: PanelSession[]
  harnesses: PanelSessionHarness[]
  /** At least one harness returned more sessions than the per-harness cap. */
  truncated: boolean
}

export type PanelSnapshot = {
  harnessPairings: PanelHarnessPairing[]
  apiVersion: number
  generatedAt: string
  agent: PanelAgentInfo
  auth: PanelAuthInfo
  config: PanelConfigInfo
  harness: PanelHarnessState
  harnesses: PanelHarness[]
  local: PanelLocalTransport
  relay: PanelRelayTransport
  clients: PanelClientInfo[]
  devices: PanelDeviceInfo[]
  push: PanelPushInfo
  controls: PanelControls
  storage: PanelStorageEntry[]
  events: PanelEvent[]
  traffic: PanelTraffic
}
