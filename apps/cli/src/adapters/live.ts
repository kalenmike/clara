import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AdapterKind } from './registry.ts'
import { resolvePaths, type ClaraPaths } from '../paths.ts'

export type AdapterHubStatus = 'connecting' | 'connected' | 'authenticated' | 'offline' | 'stopped'

export type AdapterEndpoints = {
  web?: string
  hub?: string
  engine?: string
}

export type AdapterHubInfo = {
  version: string
  protocol: number
  room?: string
  endpoints?: AdapterEndpoints
  updatedAt: number
}

export type AdapterLiveState = {
  pid: number
  startedAt: number
  updatedAt: number
  harnessId: string
  hubInfo?: AdapterHubInfo
  hub: {
    url: string
    status: AdapterHubStatus
    connected: boolean
    authenticated: boolean
    lastFrameAt?: number
    lastError?: string
    lastDisconnect?: { code: number; reason: string; at: number }
  }
  harness: {
    url: string
    reachable?: boolean
    version?: string
    code?: string
    latencyMs?: number
    checkedAt?: number
    message?: string
  }
}

/**
 * The adapter owns `state.json`; the command reads it so an adapter-only
 * machine can show the hub it is paired with without opening a connection.
 */
export function readAdapterLiveState(
  kind: AdapterKind,
  paths: ClaraPaths = resolvePaths()
): AdapterLiveState | undefined {
  const path = join(paths.dataDir, 'adapters', kind, 'state.json')
  if (!existsSync(path)) return undefined
  try {
    return normalize(JSON.parse(readFileSync(path, 'utf8')) as unknown)
  } catch {
    return undefined
  }
}

function normalize(value: unknown): AdapterLiveState | undefined {
  if (!isRecord(value)) return undefined
  const hub = isRecord(value.hub) ? value.hub : undefined
  const harness = isRecord(value.harness) ? value.harness : undefined
  if (!hub || typeof hub.url !== 'string' || !harness || typeof harness.url !== 'string') {
    return undefined
  }
  if (typeof value.updatedAt !== 'number') return undefined

  const hubInfo = normalizeHubInfo(value.hubInfo)
  return {
    pid: typeof value.pid === 'number' ? value.pid : 0,
    startedAt: typeof value.startedAt === 'number' ? value.startedAt : 0,
    updatedAt: value.updatedAt,
    harnessId: typeof value.harnessId === 'string' ? value.harnessId : '',
    ...(hubInfo ? { hubInfo } : {}),
    hub: {
      url: hub.url,
      status: isHubStatus(hub.status) ? hub.status : 'offline',
      connected: hub.connected === true,
      authenticated: hub.authenticated === true,
      ...(typeof hub.lastFrameAt === 'number' ? { lastFrameAt: hub.lastFrameAt } : {}),
      ...(typeof hub.lastError === 'string' ? { lastError: hub.lastError } : {}),
      ...(normalizeDisconnect(hub.lastDisconnect) ?? {}),
    },
    harness: {
      url: harness.url,
      ...(typeof harness.reachable === 'boolean' ? { reachable: harness.reachable } : {}),
      ...(typeof harness.version === 'string' ? { version: harness.version } : {}),
      ...(typeof harness.code === 'string' ? { code: harness.code } : {}),
      ...(typeof harness.latencyMs === 'number' ? { latencyMs: harness.latencyMs } : {}),
      ...(typeof harness.checkedAt === 'number' ? { checkedAt: harness.checkedAt } : {}),
      ...(typeof harness.message === 'string' ? { message: harness.message } : {}),
    },
  }
}

function normalizeHubInfo(value: unknown): AdapterHubInfo | undefined {
  if (!isRecord(value)) return undefined
  if (typeof value.version !== 'string' || typeof value.protocol !== 'number') return undefined
  return {
    version: value.version,
    protocol: value.protocol,
    ...(typeof value.room === 'string' ? { room: value.room } : {}),
    ...(normalizeEndpoints(value.endpoints) ?? {}),
    updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : 0,
  }
}

function normalizeEndpoints(value: unknown): { endpoints: AdapterEndpoints } | undefined {
  if (!isRecord(value)) return undefined
  const endpoints: AdapterEndpoints = {}
  if (typeof value.web === 'string') endpoints.web = value.web
  if (typeof value.hub === 'string') endpoints.hub = value.hub
  if (typeof value.engine === 'string') endpoints.engine = value.engine
  return Object.keys(endpoints).length > 0 ? { endpoints } : undefined
}

function normalizeDisconnect(
  value: unknown
): { lastDisconnect: NonNullable<AdapterLiveState['hub']['lastDisconnect']> } | undefined {
  if (!isRecord(value)) return undefined
  if (
    typeof value.code !== 'number' ||
    typeof value.reason !== 'string' ||
    typeof value.at !== 'number'
  ) {
    return undefined
  }
  return { lastDisconnect: { code: value.code, reason: value.reason, at: value.at } }
}

function isHubStatus(value: unknown): value is AdapterHubStatus {
  return (
    value === 'connecting' ||
    value === 'connected' ||
    value === 'authenticated' ||
    value === 'offline' ||
    value === 'stopped'
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
