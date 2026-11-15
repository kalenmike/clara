import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export type ServiceName = 'hub' | 'engine' | 'web'

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
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}
