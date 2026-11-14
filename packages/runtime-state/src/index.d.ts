export type RuntimeMode = 'local' | 'container'

export type RuntimeEndpoint = {
  host: string
  port: number
  url: string
}

export type RuntimeLocalEndpoint = RuntimeEndpoint & {
  wsUrl: string
}

export type RuntimePanelEndpoint = RuntimeEndpoint

export type RuntimeState = {
  schema: 1
  state: 'running' | 'stopped'
  pid: number
  startedAt: string
  updatedAt: string
  version: string
  mode: RuntimeMode
  configDir: string
  dataDir: string
  local?: RuntimeLocalEndpoint
  panel?: RuntimePanelEndpoint
}

export type RuntimeLock =
  | {
      acquired: true
      path: string
      release: () => void
    }
  | {
      acquired: false
      path: string
      pid?: number
    }

export function runtimeFile(env?: NodeJS.ProcessEnv): string
export function readRuntimeState(file?: string): RuntimeState | undefined
export function writeRuntimeState(state: RuntimeState, file?: string): string
export function stopRuntimeState(file?: string): void
export function isProcessAlive(pid: number): boolean
export function isRuntimeLive(state: RuntimeState | undefined): boolean
export function acquireRuntimeLock(file?: string): RuntimeLock
