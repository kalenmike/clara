import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/**
 * A `clara stop` request the supervisor can see without a signal.
 *
 * POSIX delivers `SIGTERM` gracefully, but Windows terminates on the same
 * call, so the CLI also leaves this file next to the supervisor's state. The
 * supervisor honours it only when it names its own pid, which keeps a stale
 * request from stopping a freshly started stack.
 */
export type StopRequest = {
  schemaVersion: 1
  supervisorPid: number
  requestedAt: string
  requestedBy?: string
}

export function readStopRequest(file: string): StopRequest | undefined {
  try {
    if (!existsSync(file)) return undefined
    const value = JSON.parse(readFileSync(file, 'utf8')) as Partial<StopRequest>
    if (value?.schemaVersion !== 1) return undefined
    if (!Number.isInteger(value.supervisorPid) || (value.supervisorPid ?? 0) <= 0) return undefined
    return {
      schemaVersion: 1,
      supervisorPid: value.supervisorPid as number,
      requestedAt:
        typeof value.requestedAt === 'string' ? value.requestedAt : new Date().toISOString(),
      ...(typeof value.requestedBy === 'string' ? { requestedBy: value.requestedBy } : {}),
    }
  } catch {
    return undefined
  }
}

/** Write atomically so a polling supervisor never reads half a request. */
export function writeStopRequest(file: string, request: StopRequest): void {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
  const temp = `${file}.${process.pid}.tmp`
  writeFileSync(temp, `${JSON.stringify(request, null, 2)}\n`, { mode: 0o600 })
  try {
    renameSync(temp, file)
  } catch (cause) {
    rmSync(temp, { force: true })
    throw cause
  }
}

export function clearStopRequest(file: string): void {
  rmSync(file, { force: true })
}
