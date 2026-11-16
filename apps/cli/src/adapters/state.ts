import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  deleteAdapterRecord as deleteSharedAdapterRecord,
  readAdapterRecords as readSharedAdapterRecords,
  readAdapterState as readSharedAdapterState,
  saveAdapterRecord as saveSharedAdapterRecord,
  writeAdapterState as writeSharedAdapterState,
  type AdapterContainerRecord as SharedAdapterContainerRecord,
  type AdapterInstallRecord as SharedAdapterInstallRecord,
  type AdapterStateFile as SharedAdapterStateFile,
} from '@clara/adapter-state'
import { ADAPTER_KINDS, type AdapterKind } from './registry.ts'
import { containerRuntimeState, type DockerRunner } from './container.ts'
import { resolvePaths, type ClaraPaths } from '../paths.ts'

export type AdapterRuntimeState = 'running' | 'stopped' | 'unknown'

export type AdapterContainerRecord = SharedAdapterContainerRecord

export type AdapterInstallRecord = SharedAdapterInstallRecord<AdapterKind>

export type AdapterStateFile = SharedAdapterStateFile<AdapterKind>

export type RunningProbe = {
  env?: NodeJS.ProcessEnv
  alive?: (pid: number) => boolean
  /** A container-backed adapter is never probed through the host pid file. */
  container?: string
  docker?: DockerRunner
}

/** `<configDir>/adapters.json`, next to the hub's `server.json`. */
export function adapterStatePath(paths: ClaraPaths = resolvePaths()): string {
  return join(paths.configDir, 'adapters.json')
}

/** The stored install records, without on-disk discovery. */
export function readAdapterState(paths: ClaraPaths = resolvePaths()): AdapterStateFile {
  return readSharedAdapterState<AdapterKind>(paths, { kinds: ADAPTER_KINDS })
}

/**
 * The install records the command should act on: stored records plus an
 * adapter installed by its own installer without writing `adapters.json`.
 */
export function readAdapterRecords(paths: ClaraPaths = resolvePaths()): AdapterStateFile {
  return readSharedAdapterRecords<AdapterKind>(paths, ADAPTER_KINDS)
}

/** Write the record file atomically so a concurrent list never reads half of it. */
export function writeAdapterState(
  state: AdapterStateFile,
  paths: ClaraPaths = resolvePaths()
): void {
  writeSharedAdapterState(state, paths)
}

export function saveAdapterRecord(
  record: AdapterInstallRecord,
  paths: ClaraPaths = resolvePaths()
): AdapterStateFile {
  return saveSharedAdapterRecord(record, paths)
}

export function deleteAdapterRecord(
  kind: AdapterKind,
  paths: ClaraPaths = resolvePaths()
): AdapterStateFile {
  return deleteSharedAdapterRecord(kind, paths)
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
  if (probe.container) return containerRuntimeState(probe.container, probe.docker)
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
  return {
    ...env,
    CLARA_ADAPTER_CONFIG_DIR: join(paths.configDir, 'adapters', kind),
    CLARA_ADAPTER_DATA_DIR: join(paths.dataDir, 'adapters', kind),
  }
}

/** `<configDir>/adapters/<kind>/config.json`, the adapter's own pairing config. */
export function adapterConfigPath(kind: AdapterKind, paths: ClaraPaths = resolvePaths()): string {
  return join(paths.configDir, 'adapters', kind, 'config.json')
}

/** Whether the adapter has a stored pairing to reuse on a reinstall. */
export function adapterHasPairing(kind: AdapterKind, paths: ClaraPaths = resolvePaths()): boolean {
  return existsSync(adapterConfigPath(kind, paths))
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
