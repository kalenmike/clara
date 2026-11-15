import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { isRuntimeLive, readRuntimeState } from '@clara/runtime-state'
import { serviceLogPath, type ClaraPaths } from '../paths.ts'
import type { Ports, ServiceName } from '../ports.ts'
import { selfCommand } from '../self.ts'
import {
  liveServicesState,
  processAlive,
  readServicesState,
  type ServicesState,
} from '../state/services.ts'
import { probe, waitFor } from './probe.ts'
import { isServiceName, SPECS, START_ORDER, ordered } from './specs.ts'
import { clearStaleStack, stopStack } from './stop.ts'
import { version } from '../version.ts'

export type ServiceStatus = {
  name: ServiceName
  state: 'running' | 'starting' | 'stopped' | 'degraded' | 'failed'
  pid: number | null
  url: string
  port: number
  uptimeMs?: number
  restarts: number
  managed: boolean
  /** Version the running service reports for itself. */
  version?: string
  /** Wire protocol the running service reports for itself. */
  protocol?: number
}

export type StatusReport = {
  version: string
  services: ServiceStatus[]
  supervisorPid: number | null
}

const START_TIMEOUT_MS = 90_000

export function defaultServices(): ServiceName[] {
  return [...START_ORDER]
}

export function resolveServices(values: readonly string[]): ServiceName[] {
  const names = values
    .flatMap((value) => value.split(',').map((item) => item.trim()))
    .filter((value): value is ServiceName => isServiceName(value))
  return ordered(names, START_ORDER)
}

export function liveState(paths: ClaraPaths): ServicesState | undefined {
  return liveServicesState(paths.stateFile)
}

export async function statusStack(
  paths: ClaraPaths,
  ports: Ports,
  services: readonly ServiceName[]
): Promise<StatusReport> {
  const state = liveState(paths)
  const runtime = readRuntimeState()
  const hubLive = isRuntimeLive(runtime)

  const statuses: ServiceStatus[] = []
  for (const name of services) {
    const spec = SPECS[name]
    const record = state?.services[name]
    let port = record?.port ?? spec.port(ports)
    let url = spec.url(ports)
    if (name === 'hub' && hubLive && runtime?.panel) {
      port = runtime.panel.port
      url = runtime.panel.url.replace(/\/+$/, '')
    }
    const pid = record?.pid ?? null
    const alive = processAlive(pid)
    const result = alive ? await probe(`${url}${spec.healthPath}`, spec.serviceId) : undefined
    const healthy = result?.ok === true
    const startedAt = record?.startedAt ? Date.parse(record.startedAt) : Number.NaN
    statuses.push({
      name,
      state: healthy
        ? 'running'
        : alive
          ? record?.state === 'starting'
            ? 'starting'
            : 'degraded'
          : record?.state === 'failed'
            ? 'failed'
            : 'stopped',
      pid,
      url,
      port,
      ...(Number.isFinite(startedAt) && healthy ? { uptimeMs: Date.now() - startedAt } : {}),
      restarts: record?.restarts ?? 0,
      managed: Boolean(state),
      ...(healthy ? reportedService(result.body) : {}),
    })
  }

  return {
    version: version(),
    services: statuses,
    supervisorPid: state?.supervisor.pid ?? null,
  }
}

/** Read the optional identity fields a healthy service reports about itself. */
export function reportedService(body: Record<string, unknown> | undefined): {
  version?: string
  protocol?: number
} {
  const version =
    typeof body?.version === 'string' && body.version.length > 0 ? body.version : undefined
  const protocol =
    typeof body?.protocol === 'number' && body.protocol > 0 ? body.protocol : undefined
  return { ...(version ? { version } : {}), ...(protocol ? { protocol } : {}) }
}

export async function startStack(options: {
  paths: ClaraPaths
  ports: Ports
  services: readonly ServiceName[]
  foreground: boolean
  onProgress?: (message: string) => void
}): Promise<number> {
  const names = options.services.length > 0 ? [...options.services] : defaultServices()
  const running = liveState(options.paths)
  if (running) {
    return 0
  }

  // An interrupted stop can leave services behind with no live supervisor.
  // Clean them up instead of starting a second stack on the same ports.
  const stale = await clearStaleStack(options.paths, { onProgress: options.onProgress })
  if (!stale.ok) {
    console.error(
      `Could not stop ${stale.survivors.join(', ')} from the previous stack; not starting another one.`
    )
    return 1
  }

  if (options.foreground) {
    const { runSupervisor } = await import('../supervisor/run.ts')
    return runSupervisor({ services: names, paths: options.paths, ports: options.ports })
  }

  const invocation = selfCommand(['__supervise', `--services=${names.join(',')}`])
  const child = spawn(invocation.command, invocation.args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env: process.env,
  })
  child.unref()

  const started = await waitFor(async () => {
    const state = liveState(options.paths)
    if (!state) return false
    return names.every((name) => {
      const record = state.services[name]
      return record?.state === 'running' && processAlive(record.pid)
    })
  }, START_TIMEOUT_MS)
  if (!started) return 1
  return 0
}

export async function restartStack(
  paths: ClaraPaths,
  ports: Ports,
  services: readonly ServiceName[]
): Promise<number> {
  const state = readServicesState(paths.stateFile)
  const previous = state?.supervisor.services ?? []
  const target = [...services]
  const result = await stopStack(paths, undefined)
  if (result.code !== 0) return result.code
  return startStack({
    paths,
    ports,
    services: target.length > 0 ? target : previous,
    foreground: false,
  })
}

export function logTail(paths: ClaraPaths, service: ServiceName, lines = 20): string {
  const file = serviceLogPath(paths.dataDir, service)
  if (!existsSync(file)) return ''
  try {
    const text = readFileSync(file, 'utf8')
    return text
      .split('\n')
      .slice(-lines - 1)
      .join('\n')
      .trimEnd()
  } catch {
    return ''
  }
}
