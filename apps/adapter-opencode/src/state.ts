import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { adapterStatePath } from './config.ts'

export type AdapterHubStatus = 'connecting' | 'connected' | 'authenticated' | 'offline' | 'stopped'

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
  opencode: {
    url: string
    reachable?: boolean
    version?: string
    code?: string
    latencyMs?: number
    checkedAt?: number
    message?: string
  }
}

export function readState(env = process.env): AdapterLiveState | undefined {
  const path = adapterStatePath(env)
  if (!existsSync(path)) return undefined
  try {
    const value = JSON.parse(readFileSync(path, 'utf8')) as Partial<AdapterLiveState>
    if (
      typeof value.pid !== 'number' ||
      typeof value.updatedAt !== 'number' ||
      !value.hub ||
      typeof value.hub.url !== 'string' ||
      !value.opencode ||
      typeof value.opencode.url !== 'string'
    ) {
      return undefined
    }
    return value as AdapterLiveState
  } catch {
    return undefined
  }
}

/** Atomic write so a status read never sees a half-written snapshot. */
export function writeState(state: AdapterLiveState, env = process.env): void {
  const path = adapterStatePath(env)
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = `${path}.tmp`
  writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 })
  renameSync(temporary, path)
}

export function removeState(env = process.env): void {
  rmSync(adapterStatePath(env), { force: true })
}
