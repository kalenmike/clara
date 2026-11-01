/**
 * Read-only DTOs for the home agent's loopback panel.
 *
 * These types are deliberately separate from the relay wire frames in
 * `frames.ts`, `actions.ts`, and `states.ts`. The panel is served by the home
 * agent on a loopback listener; it never travels through the relay.
 */

export const PANEL_API_VERSION = 2

export type PanelValueSource = 'env' | 'file' | 'service' | 'default' | 'generated' | 'none'

export type PanelValue<T> = {
  value: T
  source: PanelValueSource
}

export type PanelHealth = 'ok' | 'warn' | 'error' | 'missing'

export type PanelDeviceClass = 'desktop' | 'mobile'

export type PanelTransport = 'local' | 'relay'

export type PanelRelayStatus =
  | 'disabled'
  | 'stopped'
  | 'connecting'
  | 'online'
  | 'reconnecting'
  | 'offline'

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
  pskConfigured: boolean
  stopped: boolean
  fingerprint?: string
}

export type PanelConfigInfo = {
  opencodeUrl: PanelValue<string>
  opencodePassword: PanelValue<boolean>
  localHost: PanelValue<string>
  localPort: PanelValue<number>
  relayUrl: PanelValue<string | null>
  relayRoom: PanelValue<string | null>
  pairingBaseUrl: PanelValue<string>
}

export type PanelOpenCodeInfo = {
  url: string
  passwordConfigured: boolean
  reachable: boolean
  desired: boolean
  effective: boolean
  version?: string
  latencyMs?: number
  checkedAt: string
  code: 'ok' | 'timeout' | 'auth' | 'http' | 'unreachable' | 'disabled'
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
  deviceClass?: PanelDeviceClass
  connectedAt: string
  lastSeenAt: string
  idleMs: number
  requests: number
  holdPhone: boolean
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

export type PanelStorageKey = 'config' | 'subscriptions' | 'vapid' | 'database'

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

export type PanelControls = {
  stopped: boolean
  features: PanelFeatureControl[]
}

export type PanelFeatureUpdate = {
  feature: PanelFeatureName
  enabled: boolean
}

export type PanelAgentUpdate = {
  stopped: boolean
}

export type PanelMutationResponse = {
  controls: PanelControls
}

export type PanelSnapshot = {
  apiVersion: number
  generatedAt: string
  agent: PanelAgentInfo
  config: PanelConfigInfo
  opencode: PanelOpenCodeInfo
  local: PanelLocalTransport
  relay: PanelRelayTransport
  clients: PanelClientInfo[]
  push: PanelPushInfo
  controls: PanelControls
  storage: PanelStorageEntry[]
  events: PanelEvent[]
}
