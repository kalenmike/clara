import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const KIND = /^[a-z0-9][a-z0-9_-]{0,31}$/

/** A container that runs the adapter on Docker's behalf, not as a host process. */
export type AdapterContainerRecord = {
  name: string
  /** The container's image entrypoint, replayed for `docker exec`. */
  entry: string[]
  /** The adapter's config directory inside the container. */
  configDir?: string
  /** The adapter's data directory inside the container, which holds `state.json`. */
  dataDir?: string
  compose?: {
    project?: string
    service?: string
    file?: string
  }
}

export type AdapterInstallRecord<K extends string = string> = {
  kind: K
  version: string
  platform: string
  /** The versioned install directory that holds a host adapter binary. */
  path?: string
  /** Set when the adapter runs in a container instead of as a host process. */
  container?: AdapterContainerRecord
  /** A JavaScript entry run with Node instead of a native binary. */
  entry?: string
  /** The Node executable that runs `entry`; defaults to the current runtime. */
  node?: string
  /** Adapter install flags replayed when the adapter is reinstalled. */
  installArgs?: string[]
  installedAt: string
  pairedAt?: string
  lastError?: string
}

export type AdapterStateFile<K extends string = string> = {
  schemaVersion: 1
  adapters: Partial<Record<K, AdapterInstallRecord<K>>>
}

/** The paths the adapter state needs; `ClaraPaths` is structurally compatible. */
export type AdapterStatePaths = {
  configDir: string
  dataDir: string
}

export type ReadAdapterStateOptions<K extends string> = {
  /** Restrict the file to known adapter kinds. */
  kinds?: readonly K[]
}

/** `<configDir>/adapters.json`, next to the hub's `server.json`. */
export function adapterStatePath(paths: AdapterStatePaths): string {
  return join(paths.configDir, 'adapters.json')
}

/** Read the install records a host wrote, ignoring malformed or unknown entries. */
export function readAdapterState<K extends string = string>(
  paths: AdapterStatePaths,
  options: ReadAdapterStateOptions<K> = {}
): AdapterStateFile<K> {
  const path = adapterStatePath(paths)
  if (!existsSync(path)) return { schemaVersion: 1, adapters: {} }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<AdapterStateFile>
    if (parsed.schemaVersion !== 1 || typeof parsed.adapters !== 'object' || !parsed.adapters) {
      return { schemaVersion: 1, adapters: {} }
    }
    const adapters: AdapterStateFile<K>['adapters'] = {}
    for (const [kind, record] of Object.entries(parsed.adapters)) {
      if (!KIND.test(kind)) continue
      if (options.kinds && !options.kinds.includes(kind as K)) continue
      if (!isRecord(record) || !isRecordEntry(record)) continue
      adapters[kind as K] = { ...record, kind: kind as K }
    }
    return { schemaVersion: 1, adapters }
  } catch {
    return { schemaVersion: 1, adapters: {} }
  }
}

/** Write the record file atomically so a concurrent list never reads half of it. */
export function writeAdapterState<K extends string>(
  state: AdapterStateFile<K>,
  paths: AdapterStatePaths
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

export function saveAdapterRecord<K extends string>(
  record: AdapterInstallRecord<K>,
  paths: AdapterStatePaths
): AdapterStateFile<K> {
  const state = readAdapterState<K>(paths)
  const next: AdapterStateFile<K> = {
    schemaVersion: 1,
    adapters: { ...state.adapters, [record.kind]: record },
  }
  writeAdapterState(next, paths)
  return next
}

export function deleteAdapterRecord<K extends string>(
  kind: K,
  paths: AdapterStatePaths
): AdapterStateFile<K> {
  const state = readAdapterState<K>(paths)
  const adapters = { ...state.adapters }
  delete adapters[kind]
  const next: AdapterStateFile<K> = { schemaVersion: 1, adapters }
  writeAdapterState(next, paths)
  return next
}

export function isAdapterKind(value: string): boolean {
  return KIND.test(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isContainerRecord(value: unknown): value is AdapterContainerRecord {
  if (!isRecord(value)) return false
  if (typeof value.name !== 'string') return false
  if (!Array.isArray(value.entry) || !value.entry.every((item) => typeof item === 'string')) {
    return false
  }
  if (value.configDir !== undefined && typeof value.configDir !== 'string') return false
  if (value.dataDir !== undefined && typeof value.dataDir !== 'string') return false
  if (value.compose !== undefined) {
    if (!isRecord(value.compose)) return false
    for (const key of ['project', 'service', 'file'] as const) {
      if (value.compose[key] !== undefined && typeof value.compose[key] !== 'string') return false
    }
  }
  return true
}

function isRecordEntry(
  value: Record<string, unknown>
): value is Omit<AdapterInstallRecord, 'kind'> {
  const hasHostPath = typeof value.path === 'string'
  const hasContainer = isContainerRecord(value.container)
  if (value.container !== undefined && !hasContainer) return false
  return (
    (hasHostPath || hasContainer) &&
    typeof value.version === 'string' &&
    typeof value.platform === 'string' &&
    typeof value.installedAt === 'string' &&
    (value.entry === undefined || typeof value.entry === 'string') &&
    (value.node === undefined || typeof value.node === 'string') &&
    (value.installArgs === undefined ||
      (Array.isArray(value.installArgs) &&
        value.installArgs.every((arg) => typeof arg === 'string'))) &&
    (value.pairedAt === undefined || typeof value.pairedAt === 'string') &&
    (value.lastError === undefined || typeof value.lastError === 'string')
  )
}
