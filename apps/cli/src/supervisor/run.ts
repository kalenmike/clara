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
import { probe, waitFor } from '../service/probe.ts'
import { SPECS, START_ORDER, STOP_ORDER } from '../service/specs.ts'

const START_TIMEOUT_MS = 60_000
const STOP_TIMEOUT_MS = 12_000
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
 * restarts a crashed child a few times, and stops everything on SIGTERM.
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

  const startedAt = new Date().toISOString()
  const children = new Map<ServiceName, ChildRecord>()
  const failed = new Set<ServiceName>()
  let shuttingDown = false

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
      supervisor: { pid: process.pid, startedAt, services: names },
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

  const stopChild = async (name: ServiceName): Promise<void> => {
    const entry = children.get(name)
    if (!entry) return
    const child = entry.child
    if (child.exitCode !== null || child.signalCode !== null) return
    child.kill('SIGTERM')
    const exited = await waitFor(
      () => child.exitCode !== null || child.signalCode !== null,
      STOP_TIMEOUT_MS,
      100
    )
    if (!exited) child.kill('SIGKILL')
    await waitFor(() => child.exitCode !== null || child.signalCode !== null, 3_000, 50)
  }

  let finish: (code: number) => void = () => undefined
  const finished = new Promise<number>((resolve) => {
    finish = resolve
  })

  const shutdown = async (code: number): Promise<number> => {
    if (!shuttingDown) {
      shuttingDown = true
      log(`stopping ${names.join(', ')}`)
      for (const name of STOP_ORDER.filter((item) => names.includes(item))) {
        await stopChild(name)
      }
      rmSync(options.paths.supervisorPidFile, { force: true })
      rmSync(options.paths.stateFile, { force: true })
      log('stopped')
    }
    finish(code)
    return code
  }

  process.once('SIGINT', () => void shutdown(0))
  process.once('SIGTERM', () => void shutdown(0))

  persist()
  for (const name of names) {
    log(`starting ${name}`)
    const ok = await startChild(name, Date.now())
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
