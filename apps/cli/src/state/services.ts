import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export type ServiceName = 'hub' | 'engine' | 'web' | 'lab'

export type ServiceRecord = {
  pid: number | null
  state: 'starting' | 'running' | 'degraded' | 'failed' | 'stopped'
  port: number
  startedAt?: string
  restarts: number
  error?: string
}

export type ServicesState = {
  schemaVersion: 1
  supervisor: {
    pid: number
    startedAt: string
    services: ServiceName[]
    /** Set while the supervisor drains its children before it exits. */
    state?: 'running' | 'stopping'
  }
  services: Partial<Record<ServiceName, ServiceRecord>>
  updatedAt: string
}

export function readServicesState(file: string): ServicesState | undefined {
  try {
    if (!existsSync(file)) return undefined
    const value = JSON.parse(readFileSync(file, 'utf8')) as ServicesState
    return value?.schemaVersion === 1 ? value : undefined
  } catch {
    return undefined
  }
}

/** The state of a stack whose supervisor is still alive. */
export function liveServicesState(file: string): ServicesState | undefined {
  const state = readServicesState(file)
  return state && processAlive(state.supervisor.pid) ? state : undefined
}

/** Write atomically so a status probe never reads a half-written file. */
export function writeServicesState(file: string, state: ServicesState): void {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
  const temp = `${file}.${process.pid}.tmp`
  writeFileSync(temp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 })
  try {
    renameSync(temp, file)
  } catch (cause) {
    rmSync(temp, { force: true })
    throw cause
  }
}

export function removeServicesState(file: string): void {
  rmSync(file, { force: true })
}

export function processAlive(pid: number | null | undefined): boolean {
  if (!Number.isInteger(pid) || (pid ?? 0) <= 0) return false
  try {
    process.kill(pid as number, 0)
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
  // A detached process can stay in the table as a zombie when the init that
  // should reap it does not (some container entrypoints). `kill(pid, 0)` still
  // succeeds, so treat it as stopped instead of waiting out the whole timeout.
  return !isZombie(pid as number)
}

function isZombie(pid: number): boolean {
  if (process.platform !== 'linux') return false
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8')
    // The command name is parenthesised and may contain spaces or parens, so
    // read the state field after the last closing paren.
    const nameEnd = stat.lastIndexOf(')')
    if (nameEnd < 0) return false
    const state = stat.slice(nameEnd + 2, nameEnd + 3)
    return state === 'Z' || state === 'X'
  } catch {
    return false
  }
}
