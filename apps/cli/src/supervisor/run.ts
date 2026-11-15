import { spawn, type ChildProcess } from 'node:child_process'
import { appendFileSync, closeSync, mkdirSync, openSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { serviceLogPath, type ClaraPaths } from '../paths.ts'
import type { Ports, ServiceName } from '../ports.ts'
import { selfCommand } from '../self.ts'
import {
  processAlive,
  readServicesState,
  writeServicesState,
  type ServiceRecord,
  type ServicesState,
} from '../state/services.ts'
import { clearStopRequest, readStopRequest } from '../state/stop-request.ts'
import { probe, waitFor } from '../service/probe.ts'
import { SPECS, START_ORDER, STOP_ORDER } from '../service/specs.ts'
import { version } from '../version.ts'
import { stopChildren } from './stop-children.ts'

const START_TIMEOUT_MS = 60_000
/** How long one child gets to exit on SIGTERM before every child is killed. */
const CHILD_STOP_GRACE_MS = 4_000
const CHILD_STOP_KILL_MS = 1_500
/**
 * The supervisor always exits within this window. `clara stop` waits longer
 * than this before it escalates, so it never kills a supervisor that is still
 * draining its children.
 */
const SHUTDOWN_DEADLINE_MS = 6_000
const STOP_REQUEST_POLL_MS = 250
const RESTART_WINDOW_MS = 60_000
const MAX_RESTARTS = 3

export type SupervisorOptions = {
  services: readonly ServiceName[]
  paths: ClaraPaths
  ports: Ports
}

type ChildRecord = {
  child: ChildProcess
  startedAt: number
  restarts: number[]
}

/**
 * The single foreground process that owns the local stack. `clara start`
 * detaches it; a login service runs it directly. It starts services in order,
 * restarts a crashed child a few times, and stops every child within one
 * bounded window when asked to shut down.
 */
export async function runSupervisor(options: SupervisorOptions): Promise<number> {
  const names = START_ORDER.filter((name) => options.services.includes(name))
  if (names.length === 0) {
    console.error('No services selected.')
    return 2
  }

  const previous = readServicesState(options.paths.stateFile)
  if (previous && processAlive(previous.supervisor.pid)) {
    console.error(`The Clara stack is already running (supervisor pid ${previous.supervisor.pid}).`)
    return 1
  }

  mkdirSync(options.paths.logDir, { recursive: true, mode: 0o700 })
  writeFileSync(options.paths.supervisorPidFile, `${process.pid}\n`, { mode: 0o600 })
  // A request from a previous supervisor can never name this pid.
  clearStopRequest(options.paths.stopRequestFile)

  const startedAt = new Date().toISOString()
  const children = new Map<ServiceName, ChildRecord>()
  const failed = new Set<ServiceName>()
  let shuttingDown = false
  let shutdownCode: number | undefined

  const log = (message: string): void => {
    appendFileSync(
      join(options.paths.logDir, 'supervisor.log'),
      `${new Date().toISOString()} ${message}\n`,
      { mode: 0o600 }
    )
  }

  const record = (name: ServiceName): ServiceRecord => {
    const child = children.get(name)
    if (child) {
      return {
        pid: child.child.pid ?? null,
        state: 'running',
        port: SPECS[name].port(options.ports),
        startedAt: new Date(child.startedAt).toISOString(),
        restarts: child.restarts.filter((at) => Date.now() - at < RESTART_WINDOW_MS).length,
      }
    }
    if (failed.has(name)) {
      return { pid: null, state: 'failed', port: SPECS[name].port(options.ports), restarts: 0 }
    }
    return { pid: null, state: 'starting', port: SPECS[name].port(options.ports), restarts: 0 }
  }

  const persist = (): void => {
    const state: ServicesState = {
      schemaVersion: 1,
      supervisor: {
        pid: process.pid,
        startedAt,
        services: names,
        state: shuttingDown ? 'stopping' : 'running',
      },
      services: Object.fromEntries(names.map((name) => [name, record(name)])),
      updatedAt: new Date().toISOString(),
    }
    writeServicesState(options.paths.stateFile, state)
  }

  const healthy = async (name: ServiceName): Promise<boolean> => {
    const spec = SPECS[name]
    const result = await probe(`${spec.url(options.ports)}${spec.healthPath}`, spec.serviceId)
    return result.ok
  }

  const exitCleanup = (name: ServiceName): void => {
    const child = children.get(name)
    if (!child) return
    children.delete(name)
    if (shuttingDown) return
    const recent = child.restarts.filter((at) => Date.now() - at < RESTART_WINDOW_MS)
    if (recent.length >= MAX_RESTARTS) {
      failed.add(name)
      log(`${name} exited too often; leaving it failed`)
      persist()
      return
    }
    log(`${name} exited; restarting`)
    child.restarts.push(Date.now())
    persist()
    setTimeout(() => {
      if (shuttingDown) return
      void startChild(name, child.startedAt, child.restarts).then((ok) => {
        persist()
        if (!ok) log(`${name} did not restart`)
      })
    }, 1_000)
  }

  const startChild = async (
    name: ServiceName,
    originalStart: number,
    restarts: number[] = []
  ): Promise<boolean> => {
    const spec = SPECS[name]
    const logFile = serviceLogPath(options.paths.dataDir, name)
    const fd = openSync(logFile, 'a', 0o600)
    let child: ChildProcess
    try {
      const invocation = selfCommand(['__serve', name])
      child = spawn(invocation.command, invocation.args, {
        env: {
          ...process.env,
          ...spec.env(options.ports),
          CLARA_SERVICE: name,
          CLARA_VERSION: version(),
        },
        stdio: ['ignore', fd, fd],
        windowsHide: true,
      })
    } finally {
      closeSync(fd)
    }
    const entry: ChildRecord = { child, startedAt: originalStart, restarts }
    children.set(name, entry)
    failed.delete(name)
    persist()
    child.once('exit', () => exitCleanup(name))

    await waitFor(
      async () => child.exitCode !== null || child.signalCode !== null || (await healthy(name)),
      START_TIMEOUT_MS
    )
    return child.exitCode === null && child.signalCode === null && (await healthy(name))
  }

  const exited = (entry: ChildRecord): boolean =>
    entry.child.exitCode !== null || entry.child.signalCode !== null

  const entryExited = (name: ServiceName): boolean => {
    const entry = children.get(name)
    return !entry || exited(entry)
  }

  let finish: (code: number) => void = () => undefined
  const finished = new Promise<number>((resolve) => {
    finish = resolve
  })
  let stopPolls: NodeJS.Timeout | undefined

  /**
   * Signal every child once, wait a single grace window for the whole set,
   * then kill whatever is left. Sequential waits let one stuck service eat the
   * caller's entire stop budget, which is what left orphaned services behind.
   */
  const shutdown = async (code: number): Promise<number> => {
    if (shuttingDown) return shutdownCode ?? code
    shuttingDown = true
    shutdownCode = code
    if (stopPolls) clearInterval(stopPolls)
    stopPolls = undefined
    persist()

    const watchdog = setTimeout(() => {
      log(`shutdown did not finish in ${SHUTDOWN_DEADLINE_MS}ms; exiting`)
      clearStopRequest(options.paths.stopRequestFile)
      rmSync(options.paths.supervisorPidFile, { force: true })
      rmSync(options.paths.stateFile, { force: true })
      process.exit(1)
    }, SHUTDOWN_DEADLINE_MS)

    const targets = STOP_ORDER.filter((name) => children.has(name))
    if (targets.length === 0) {
      log('no services to stop')
    } else {
      log(`stopping ${targets.join(', ')}`)
      const startedStopping = Date.now()
      const result = await stopChildren(
        targets.map((name) => ({
          label: name,
          exited: () => entryExited(name),
          signal: (signal: NodeJS.Signals) => {
            const entry = children.get(name)
            if (entry) entry.child.kill(signal)
          },
        })),
        {
          graceMs: CHILD_STOP_GRACE_MS,
          killMs: CHILD_STOP_KILL_MS,
          onEscalate: (labels) => log(`${labels.join(', ')} did not stop; sending SIGKILL`),
        }
      )
      if (result.graceful) {
        log(`stopped ${targets.join(', ')} in ${Date.now() - startedStopping}ms`)
      } else if (result.survivors.length > 0) {
        log(`${result.survivors.join(', ')} is still running after SIGKILL`)
      }
    }

    clearTimeout(watchdog)
    clearStopRequest(options.paths.stopRequestFile)
    rmSync(options.paths.supervisorPidFile, { force: true })
    rmSync(options.paths.stateFile, { force: true })
    log('stopped')
    finish(code)
    return code
  }

  const onSignal = (): void => {
    void shutdown(0)
  }
  // Keep both listeners: a second stop signal during shutdown must not fall
  // through to the default action and kill the supervisor mid-cleanup.
  process.on('SIGINT', onSignal)
  process.on('SIGTERM', onSignal)

  // Windows delivers `SIGTERM` as an immediate termination, so the CLI also
  // leaves a request file. Honour it only when it names this process.
  stopPolls = setInterval(() => {
    if (shuttingDown) {
      if (stopPolls) clearInterval(stopPolls)
      stopPolls = undefined
      return
    }
    const request = readStopRequest(options.paths.stopRequestFile)
    if (request?.supervisorPid === process.pid) {
      log('stop requested')
      void shutdown(0)
    }
  }, STOP_REQUEST_POLL_MS)

  persist()
  for (const name of names) {
    if (shuttingDown) break
    log(`starting ${name}`)
    const ok = await startChild(name, Date.now())
    if (shuttingDown) break
    if (!ok) {
      log(`${name} did not become healthy`)
      failed.add(name)
      persist()
      await shutdown(1)
      return 1
    }
    log(`${name} is healthy`)
    persist()
  }

  return finished
}
