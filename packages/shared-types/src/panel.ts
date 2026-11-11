/**
 * Read-only DTOs for the home agent's loopback panel.
 *
 * These types are deliberately separate from the relay wire frames in
 * `frames.ts`, `actions.ts`, and `states.ts`. The panel is served by the home
 * agent on a loopback listener; it never travels through the relay.
 */

export const PANEL_API_VERSION = 10

export type PanelValueSource = 'env' | 'file' | 'database' | 'default' | 'generated' | 'none'

export type PanelValue<T> = {
  value: T
  source: PanelValueSource
}

export type PanelHealth = 'ok' | 'warn' | 'error' | 'missing'

export type PanelDeviceClass = 'desktop' | 'mobile'

export type PanelTransport = 'local' | 'relay'

/** `enroll` is a one-time pairing session that has no device yet. */
export type PanelClientKind = 'device' | 'enroll'

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
  /** True when this agent runs in a container. */
  container: boolean
}

export type PanelConfigInfo = {
  localHost: PanelValue<string>
  localPort: PanelValue<number>
  relayUrl: PanelValue<string | null>
  relayRoom: PanelValue<string | null>
  pairingBaseUrl: PanelValue<string>
  vapidSubject: PanelValue<string>
}

export type PanelConfigUpdate = {
  pairingBaseUrl?: string | null
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
  | { authenticated: false; setupRequired: boolean; resetPending: boolean }
  | { authenticated: true; user: PanelAuthInfo }

export type PanelLoginUpdate = {
  username: string
  password: string
}

export type PanelSetupUpdate = {
  token: string
  username: string
  password: string
}

export type PanelPasswordUpdate = {
  currentPassword: string
  newPassword: string
}

export type PanelHarnessKind = 'opencode'
export type PanelHarnessAuthType = 'none' | 'basic'

export type PanelHarness = {
  id: string
  kind: PanelHarnessKind
  label: string
  baseUrl: string
  authType: PanelHarnessAuthType
  username?: string
  options: Record<string, unknown>
  isActive: boolean
  secretConfigured: boolean
  lastTestAt?: string
  lastTestOk?: boolean
  lastTestError?: string
  createdAt: string
  updatedAt: string
}

export type PanelHarnessState = {
  configured: boolean
  activeId?: string
  error?: string
}

export type PanelHarnessUpdate = {
  kind: PanelHarnessKind
  label: string
  baseUrl: string
  authType: PanelHarnessAuthType
  username?: string
  /** Empty or absent while editing keeps the stored secret. */
  password?: string
  options?: Record<string, unknown>
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
    'ok' | 'timeout' | 'auth' | 'http' | 'unreachable' | 'disabled' | 'unconfigured' | 'unsupported'
  error?: string
}

export type PanelLocalTransport = {
  host: string
  port: number
  url: string
  connections: number
  desired: boolean
  active: boolean
  effective: boolean
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
  clientTokenConfigured: boolean
  connectedSince?: string
  lastChangedAt?: string
  reconnectAttempts?: number
  lastError?: string
  error?: string
}

export type PanelClientInfo = {
  sid: string
  transport: PanelTransport
  kind: PanelClientKind
  deviceId?: string
  deviceLabel?: string
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

export type PanelPushInfo = {
  enabled: boolean
  desired: boolean
  effective: boolean
  subscriptions: number
  failing: number
  publicKeyConfigured: boolean
  error?: string
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

/**
 * `off` blocks every command request. `allowlist` admits a request only when
 * one of `commands` is an argv prefix of it; an empty list allows every
 * command. Entries are literal tokens, never shell syntax, and a request that
 * contains shell metacharacters never matches a non-empty list.
 */
export type ShellPolicyMode = 'off' | 'allowlist'

export type ShellPolicy = {
  mode: ShellPolicyMode
  /** Literal command prefixes, for example `git log`. */
  commands: string[]
}

export type PanelShellControl = ShellPolicy & {
  /** Command requests the agent refused since it started. */
  blocked: number
}

export type PanelControls = {
  stopped: boolean
  features: PanelFeatureControl[]
  shell: PanelShellControl
  monitoring: PanelMonitoringControl
  sync: PanelSyncControl
  orchestration: PanelOrchestrationControl
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
  /** Whether this home agent should keep a local service running. */
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

export type PanelShellUpdate = ShellPolicy

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

export type PanelMutationResponse = {
  controls: PanelControls
}

/**
 * Error counters for the traffic meter. They are named for what the agent
 * observed, never for a payload it decrypted and kept.
 */
export type PanelTrafficErrorKey =
  'handshake' | 'crypto' | 'orphan' | 'dropped' | 'refused' | 'limited' | 'upstream' | 'expired'

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

export type PanelSnapshot = {
  apiVersion: number
  generatedAt: string
  agent: PanelAgentInfo
  auth: PanelAuthInfo
  config: PanelConfigInfo
  opencode: PanelOpenCodeInfo
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
