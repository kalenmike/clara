/** Stable identity shared by every harness adapter. */
export type AdapterIdentity = {
  harnessId: string
  adapterId: string
  key: string
}

/** Per-adapter file locations. Nothing here is harness-specific. */
export type AdapterPaths = {
  name: string
  configDir: string
  dataDir: string
  configPath: string
  identityPath: string
  logPath: string
  pidPath: string
  statePath: string
}

/** Connection fields every adapter config carries. */
export type AdapterConnectionConfig = {
  harnessId: string
  adapterId: string
  key: string
  wsUrl: string
  clientToken: string
  label?: string
}

export type AdapterConfig<THarness> = AdapterConnectionConfig & THarness

export type AdapterHubStatus = 'connecting' | 'connected' | 'authenticated' | 'offline' | 'stopped'

export type AdapterHarnessHealth = {
  url: string
  reachable?: boolean
  version?: string
  code?: string
  latencyMs?: number
  checkedAt?: number
  message?: string
}

export type AdapterLiveState = {
  pid: number
  startedAt: number
  updatedAt: number
  harnessId: string
  hub: {
    url: string
    status: AdapterHubStatus
    connected: boolean
    authenticated: boolean
    lastFrameAt?: number
    lastError?: string
  }
  harness: AdapterHarnessHealth
}

export type AdapterProbe = {
  ok: boolean
  version?: string
  status?: number
  latencyMs: number
  code: string
  message?: string
}

export type AdapterInfo = {
  adapter: { name: string; version: string }
  harness: { kind: string; version?: string }
  capabilities: Record<string, unknown>
}

export type ServiceResult = {
  service: 'systemd' | 'launchd' | 'process' | 'none'
  unitPath?: string
  actions: string[]
  warning?: string
}

export type AdapterProcessStatus = {
  running: boolean
  pid?: number
  log: string
}

export type AdapterStartResult = ServiceResult & { logOffset: number }
