import { spawnSync } from 'node:child_process'
import { posix } from 'node:path'
import { parseAdapterLiveState, type AdapterLiveState } from './live.ts'

/** The minimal result the command needs from a Docker invocation. */
export type DockerResult = {
  code: number
  stdout: string
  stderr: string
}

/** Injectable so tests never need a Docker daemon. */
export type DockerRunner = (args: readonly string[]) => DockerResult

/** A status probe that gives up instead of hanging a `status` command. */
const DOCKER_TIMEOUT_MS = 10_000

export type AdapterComposeInfo = {
  project?: string
  service?: string
  file?: string
}

/** What the command needs to know about a running adapter container. */
export type ContainerInfo = {
  name: string
  running: boolean
  /** The adapter command, taken from the container's image entrypoint. */
  entry: string[]
  /** `CLARA_ADAPTER_CONFIG_DIR` inside the container, when the image sets it. */
  configDir?: string
  /** `CLARA_ADAPTER_DATA_DIR` inside the container, when the image sets it. */
  dataDir?: string
  compose?: AdapterComposeInfo
}

export type ContainerStatus = {
  /** The adapter version the container reports about itself. */
  version?: string
  /** Whether the container already holds a pairing config. */
  paired: boolean
}

export function runDocker(args: readonly string[]): DockerResult {
  const result = spawnSync('docker', [...args], {
    encoding: 'utf8',
    timeout: DOCKER_TIMEOUT_MS,
    windowsHide: true,
  })
  if (result.error) return { code: 1, stdout: '', stderr: result.error.message }
  return { code: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

/** Read the fields of `docker inspect <name>` the adapter commands rely on. */
export function inspectContainer(name: string, docker: DockerRunner = runDocker): ContainerInfo {
  const result = docker(['inspect', name])
  if (result.code !== 0) {
    throw new Error(
      `Cannot inspect container ${name}: ${
        result.stderr.trim() || `docker exited with ${result.code}`
      }`
    )
  }
  const item = inspectItem(result.stdout, name)
  if (!item) throw new Error(`Docker did not describe container ${name}.`)

  const state = isRecord(item.State) ? item.State : {}
  const config = isRecord(item.Config) ? item.Config : {}
  const labels = isRecord(config.Labels) ? config.Labels : {}
  const entry = stringList(config.Entrypoint)
  if (entry.length === 0) {
    throw new Error(
      `Container ${name} has no entrypoint to run the adapter. Set one such as ` +
        '`node /app/dist/index.js`, or run the install command inside the container.'
    )
  }
  const env = stringList(config.Env)
  const configDir = environmentValue(env, 'CLARA_ADAPTER_CONFIG_DIR')
  const dataDir = environmentValue(env, 'CLARA_ADAPTER_DATA_DIR')
  const compose = composeInfo(labels)
  return {
    name,
    running: state.Running === true,
    entry,
    ...(configDir ? { configDir } : {}),
    ...(dataDir ? { dataDir } : {}),
    ...(compose ? { compose } : {}),
  }
}

/**
 * Best-effort state for `AdapterInstallRecord`. A missing container or a Docker
 * failure stays `unknown`, matching the pid probe instead of claiming stopped.
 */
export function containerRuntimeState(
  name: string,
  docker: DockerRunner = runDocker
): 'running' | 'stopped' | 'unknown' {
  const result = docker(['inspect', '-f', '{{.State.Running}}', name])
  if (result.code !== 0) return 'unknown'
  const value = result.stdout.trim()
  if (value === 'true') return 'running'
  if (value === 'false') return 'stopped'
  return 'unknown'
}

/** Ask the adapter inside the container about itself. */
export function readContainerStatus(
  info: ContainerInfo,
  docker: DockerRunner = runDocker
): ContainerStatus {
  if (!info.running) return { paired: containerHasConfig(info, docker) }
  const result = docker(['exec', info.name, ...info.entry, 'status'])
  if (result.code !== 0) return { paired: containerHasConfig(info, docker) }
  const version = /^adapter:\s+\S+\s+(\S+)/mu.exec(result.stdout)?.[1]
  const paired = /^config:\s+(?!missing\b)\S/mu.test(result.stdout)
  return { ...(version ? { version } : {}), paired }
}

/** What the command needs to read live state, from a probe or a saved record. */
export type ContainerLiveSource = {
  name: string
  entry: string[]
  dataDir?: string
  running?: boolean
}

/** Read the adapter's live state from the container's data directory. */
export function readContainerLiveState(
  info: ContainerLiveSource,
  docker: DockerRunner = runDocker
): AdapterLiveState | undefined {
  if (info.running === false || !info.dataDir) return undefined
  const result = docker(['exec', info.name, 'cat', posix.join(info.dataDir, 'state.json')])
  if (result.code !== 0) return undefined
  try {
    return parseAdapterLiveState(JSON.parse(result.stdout) as unknown)
  } catch {
    return undefined
  }
}

export function startContainer(name: string, docker: DockerRunner = runDocker): DockerResult {
  return docker(['start', name])
}

export function stopContainer(name: string, docker: DockerRunner = runDocker): DockerResult {
  return docker(['stop', name])
}

export function containerLogs(
  name: string,
  lines: number,
  docker: DockerRunner = runDocker
): DockerResult {
  return docker(['logs', '--tail', String(lines), name])
}

export function isContainerRecord(value: unknown): value is {
  name: string
  entry: string[]
  compose?: AdapterComposeInfo
} {
  if (!isRecord(value)) return false
  if (typeof value.name !== 'string' || value.name.trim() === '') return false
  if (!stringList(value.entry).length) return false
  if (value.configDir !== undefined && typeof value.configDir !== 'string') return false
  if (value.dataDir !== undefined && typeof value.dataDir !== 'string') return false
  if (value.compose !== undefined && !isComposeInfo(value.compose)) return false
  return true
}

function inspectItem(text: string, name: string): Record<string, unknown> | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error(`Docker returned invalid JSON for container ${name}.`)
  }
  const item = Array.isArray(parsed) ? parsed[0] : parsed
  return isRecord(item) ? item : undefined
}

function composeInfo(labels: Record<string, unknown>): AdapterComposeInfo | undefined {
  const project = label(labels, 'com.docker.compose.project')
  const service = label(labels, 'com.docker.compose.service')
  const file = label(labels, 'com.docker.compose.project.config_files')
  if (!project && !service && !file) return undefined
  return {
    ...(project ? { project } : {}),
    ...(service ? { service } : {}),
    ...(file ? { file } : {}),
  }
}

function isComposeInfo(value: unknown): value is AdapterComposeInfo {
  if (!isRecord(value)) return false
  return ['project', 'service', 'file'].every(
    (key) => value[key] === undefined || typeof value[key] === 'string'
  )
}

function containerHasConfig(info: ContainerInfo, docker: DockerRunner): boolean {
  if (!info.configDir) return false
  const configPath = posix.join(info.configDir, 'config.json')
  return docker(['cp', `${info.name}:${configPath}`, '-']).code === 0
}

function environmentValue(env: readonly string[], name: string): string | undefined {
  for (const entry of env) {
    if (!entry.startsWith(`${name}=`)) continue
    const value = entry.slice(name.length + 1).trim()
    if (value) return value
  }
  return undefined
}

function label(labels: Record<string, unknown>, name: string): string | undefined {
  const value = labels[name]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
