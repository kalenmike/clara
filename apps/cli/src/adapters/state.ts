import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { isAdapterKind, type AdapterKind } from './registry.ts'
import { resolvePaths, type ClaraPaths } from '../paths.ts'

export type AdapterRuntimeState = 'running' | 'stopped' | 'unknown'

export type AdapterInstallRecord = {
  kind: AdapterKind
  version: string
  platform: string
  /** The versioned install directory that holds the adapter binary. */
  path: string
  installedAt: string
  pairedAt?: string
  lastError?: string
}

export type AdapterStateFile = {
  schemaVersion: 1
  adapters: Partial<Record<AdapterKind, AdapterInstallRecord>>
}

export type RunningProbe = {
  env?: NodeJS.ProcessEnv
  alive?: (pid: number) => boolean
}

/** `<configDir>/adapters.json`, next to the hub's `server.json`. */
export function adapterStatePath(paths: ClaraPaths = resolvePaths()): string {
  return join(paths.configDir, 'adapters.json')
}

export function readAdapterState(paths: ClaraPaths = resolvePaths()): AdapterStateFile {
  const path = adapterStatePath(paths)
  if (!existsSync(path)) return { schemaVersion: 1, adapters: {} }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<AdapterStateFile>
    if (parsed.schemaVersion !== 1 || typeof parsed.adapters !== 'object' || !parsed.adapters) {
      return { schemaVersion: 1, adapters: {} }
    }
    const adapters: AdapterStateFile['adapters'] = {}
    for (const [kind, record] of Object.entries(parsed.adapters)) {
      if (!isAdapterKind(kind) || !isRecord(record)) continue
      if (!isRecordEntry(record)) continue
      adapters[kind] = { ...record, kind }
    }
    return { schemaVersion: 1, adapters }
  } catch {
    return { schemaVersion: 1, adapters: {} }
  }
}

/** Write the record file atomically so a concurrent list never reads half of it. */
export function writeAdapterState(
  state: AdapterStateFile,
  paths: ClaraPaths = resolvePaths()
): void {
  const path = adapterStatePath(paths)
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const temp = `${path}.${process.pid}.tmp`
  writeFileSync(temp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 })
  try {
    renameSync(temp, path)
  } catch (cause) {
    rmSync(temp, { force: true })
    throw cause
  }
}

export function saveAdapterRecord(
  record: AdapterInstallRecord,
  paths: ClaraPaths = resolvePaths()
): AdapterStateFile {
  const state = readAdapterState(paths)
  const next: AdapterStateFile = {
    schemaVersion: 1,
    adapters: { ...state.adapters, [record.kind]: record },
  }
  writeAdapterState(next, paths)
  return next
}

export function deleteAdapterRecord(
  kind: AdapterKind,
  paths: ClaraPaths = resolvePaths()
): AdapterStateFile {
  const state = readAdapterState(paths)
  const adapters = { ...state.adapters }
  delete adapters[kind]
  const next: AdapterStateFile = { schemaVersion: 1, adapters }
  writeAdapterState(next, paths)
  return next
}

/**
 * Best-effort process check. Adapters write `adapter.pid` under their own XDG
 * data directory; a missing file means the adapter has not reported, so the
 * answer stays `unknown` rather than guessing.
 */
export function adapterRuntimeState(
  kind: AdapterKind,
  probe: RunningProbe = {}
): AdapterRuntimeState {
  const pidPath = join(adapterDataDir(kind, probe.env ?? process.env), 'adapter.pid')
  if (!existsSync(pidPath)) return 'unknown'
  try {
    const pid = Number.parseInt(readFileSync(pidPath, 'utf8').trim(), 10)
    if (!Number.isInteger(pid) || pid <= 0) return 'unknown'
    const alive = probe.alive ?? isAlive
    return alive(pid) ? 'running' : 'stopped'
  } catch {
    return 'unknown'
  }
}

/**
 * Environment for an adapter child. The adapter runtime keeps its pid, log, and
 * state next to its versions, so point it at the same data directory the
 * command installed it under instead of the platform default.
 */
export function adapterEnv(
  paths: ClaraPaths,
  kind: AdapterKind,
  env = process.env
): NodeJS.ProcessEnv {
  return { ...env, CLARA_ADAPTER_DATA_DIR: join(paths.dataDir, 'adapters', kind) }
}

/** The data directory the adapter runtime uses for its pid, log, and state. */
export function adapterDataDir(kind: AdapterKind, env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.CLARA_ADAPTER_DATA_DIR?.trim()
  if (configured) return configured
  const base = env.XDG_DATA_HOME?.trim() || join(homedir(), '.local', 'share')
  return join(base, 'clara', 'adapters', kind)
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isRecordEntry(
  value: Record<string, unknown>
): value is Omit<AdapterInstallRecord, 'kind'> {
  return (
    typeof value.version === 'string' &&
    typeof value.platform === 'string' &&
    typeof value.path === 'string' &&
    typeof value.installedAt === 'string' &&
    (value.pairedAt === undefined || typeof value.pairedAt === 'string') &&
    (value.lastError === undefined || typeof value.lastError === 'string')
  )
}
