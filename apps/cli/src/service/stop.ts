import { readFileSync, rmSync } from 'node:fs'
import type { ClaraPaths } from '../paths.ts'
import type { ServiceName } from '../ports.ts'
import {
  liveServicesState,
  processAlive,
  readServicesState,
  writeServicesState,
  type ServicesState,
} from '../state/services.ts'
import {
  clearStopRequest,
  readStopRequest,
  writeStopRequest,
  type StopRequest,
} from '../state/stop-request.ts'
import { waitFor } from './probe.ts'
import { START_ORDER } from './specs.ts'

/**
 * The supervisor always exits within its own shutdown deadline. Wait past it
 * before escalating so the CLI never kills a supervisor that is still draining
 * its children.
 */
const SUPERVISOR_STOP_GRACE_MS = 8_000
const SUPERVISOR_STOP_KILL_MS = 2_000
const CHILD_STOP_GRACE_MS = 2_000
const CHILD_STOP_KILL_MS = 1_000

export type StopTimings = {
  supervisorGraceMs: number
  supervisorKillMs: number
  childGraceMs: number
  childKillMs: number
}

export const DEFAULT_STOP_TIMINGS: StopTimings = {
  supervisorGraceMs: SUPERVISOR_STOP_GRACE_MS,
  supervisorKillMs: SUPERVISOR_STOP_KILL_MS,
  childGraceMs: CHILD_STOP_GRACE_MS,
  childKillMs: CHILD_STOP_KILL_MS,
}

export type StopOptions = {
  timings?: Partial<StopTimings>
  onProgress?: (message: string) => void
}

export type StopResult = {
  code: number
  /** Services the CLI signalled itself because they outlived the supervisor. */
  cleaned: ServiceName[]
  /** Services that were still alive after the final escalation. */
  survivors: ServiceName[]
  /** The supervisor ignored SIGTERM and was killed. */
  escalated: boolean
}

export type TerminateResult = {
  stopped: boolean
  /** SIGTERM was not enough; the process had to be killed. */
  escalated: boolean
}

function timings(options: StopOptions): StopTimings {
  return { ...DEFAULT_STOP_TIMINGS, ...options.timings }
}

export async function stopStack(
  paths: ClaraPaths,
  target: ServiceName | undefined,
  options: StopOptions = {}
): Promise<StopResult> {
  const limits = timings(options)
  const state = readServicesState(paths.stateFile)
  const supervisorPid = state?.supervisor.pid

  if (
    target &&
    state &&
    !(state.supervisor.services.length === 1 && state.supervisor.services[0] === target)
  ) {
    throw new Error(
      `The stack is supervised as one process (${state.supervisor.services.join(', ')}). Run \`clara stop\` to stop it.`
    )
  }

  let escalated = false
  let stoppedPid: number | undefined
  const supervisor =
    state && processAlive(supervisorPid) ? supervisorPid : readLiveSupervisorPid(paths)

  if (supervisor !== undefined) {
    stoppedPid = supervisor
    options.onProgress?.('Stopping the Clara stack')
    requestStop(paths, supervisor)
    const result = await terminateProcess(supervisor, {
      graceMs: limits.supervisorGraceMs,
      killMs: limits.supervisorKillMs,
      signal: process.platform !== 'win32',
    })
    escalated = result.escalated
  }

  // A supervisor that was killed cannot drain its children. Stop any recorded
  // service that outlived it before the state is discarded.
  const pending = recordedServices(state).filter(({ pid }) => processAlive(pid))
  const cleaned: ServiceName[] = []
  if (pending.length > 0) {
    options.onProgress?.(`Stopping ${pending.map(({ name }) => name).join(', ')}`)
    const results = await Promise.all(
      pending.map(async ({ name, pid }) => ({
        name,
        stopped: (
          await terminateProcess(pid, {
            graceMs: limits.childGraceMs,
            killMs: limits.childKillMs,
          })
        ).stopped,
      }))
    )
    for (const item of results) if (item.stopped) cleaned.push(item.name)
  }

  const survivors = recordedServices(state)
    .filter(({ pid }) => processAlive(pid))
    .map(({ name }) => name)

  if (survivors.length === 0) {
    removeStackState(paths, stoppedPid)
  } else {
    keepStackState(paths, state)
  }

  return { code: survivors.length === 0 ? 0 : 1, cleaned, survivors, escalated }
}

/**
 * Clear a stack whose supervisor is gone but whose services are not. Returns
 * `ok: false` only when a service still refuses to stop, so `clara start` does
 * not open a second stack on the same ports.
 */
export async function clearStaleStack(
  paths: ClaraPaths,
  options: StopOptions = {}
): Promise<{ ok: boolean; survivors: ServiceName[] }> {
  const state = readServicesState(paths.stateFile)
  if (!state) {
    clearStopRequest(paths.stopRequestFile)
    return { ok: true, survivors: [] }
  }
  if (processAlive(state.supervisor.pid)) return { ok: true, survivors: [] }

  const alive = recordedServices(state).filter(({ pid }) => processAlive(pid))
  if (alive.length === 0) {
    removeStackState(paths, state.supervisor.pid)
    return { ok: true, survivors: [] }
  }

  options.onProgress?.('Cleaning up services left by a previous stop')
  const result = await stopStack(paths, undefined, options)
  return { ok: result.code === 0, survivors: result.survivors }
}

/** Wait for a supervisor that is already stopping; used before a restart. */
export async function waitForStackStop(paths: ClaraPaths, timeoutMs = 10_000): Promise<boolean> {
  return waitFor(() => !liveServicesState(paths.stateFile), timeoutMs, 100)
}

export async function terminateProcess(
  pid: number,
  options: { graceMs: number; killMs: number; signal?: boolean }
): Promise<TerminateResult> {
  if (!processAlive(pid)) return { stopped: true, escalated: false }
  // Windows delivers SIGTERM as an immediate termination, so a supervisor that
  // watches `stop.request` must be given time to read it instead.
  if (options.signal !== false) {
    try {
      process.kill(pid, 'SIGTERM')
    } catch {
      return { stopped: !processAlive(pid), escalated: false }
    }
  }
  if (await waitFor(() => !processAlive(pid), options.graceMs, 100)) {
    return { stopped: true, escalated: false }
  }
  try {
    process.kill(pid, 'SIGKILL')
  } catch {
    return { stopped: !processAlive(pid), escalated: true }
  }
  return {
    stopped: await waitFor(() => !processAlive(pid), options.killMs, 50),
    escalated: true,
  }
}

function recordedServices(state: ServicesState | undefined): { name: ServiceName; pid: number }[] {
  if (!state) return []
  return START_ORDER.flatMap((name) => {
    const pid = state.services[name]?.pid
    return typeof pid === 'number' && pid > 0 ? [{ name, pid }] : []
  })
}

function requestStop(paths: ClaraPaths, supervisorPid: number): void {
  const request: StopRequest = {
    schemaVersion: 1,
    supervisorPid,
    requestedAt: new Date().toISOString(),
    requestedBy: `cli ${process.pid}`,
  }
  try {
    writeStopRequest(paths.stopRequestFile, request)
  } catch {
    // The signal still reaches a POSIX supervisor; the request is a fallback.
  }
}

/**
 * Remove the stack files only while they still describe the stack we stopped.
 * A concurrent `clara start` may already have written a new supervisor.
 */
function removeStackState(paths: ClaraPaths, supervisorPid: number | undefined): void {
  const request = readStopRequest(paths.stopRequestFile)
  if (!request || supervisorPid === undefined || request.supervisorPid === supervisorPid) {
    clearStopRequest(paths.stopRequestFile)
  }
  const current = readServicesState(paths.stateFile)
  if (!current || supervisorPid === undefined || current.supervisor.pid === supervisorPid) {
    rmSync(paths.stateFile, { force: true })
  }
  const recorded = readSupervisorPid(paths)
  if (recorded === undefined || supervisorPid === undefined || recorded === supervisorPid) {
    rmSync(paths.supervisorPidFile, { force: true })
  }
}

/** Keep the known pids so a later stop or start can still find them. */
function keepStackState(paths: ClaraPaths, state: ServicesState | undefined): void {
  if (!state) return
  try {
    writeServicesState(paths.stateFile, {
      ...state,
      supervisor: { ...state.supervisor, state: 'stopping' },
      updatedAt: new Date().toISOString(),
    })
  } catch {
    // Leave the previous file in place.
  }
}

function readLiveSupervisorPid(paths: ClaraPaths): number | undefined {
  const pid = readSupervisorPid(paths)
  return pid !== undefined && processAlive(pid) ? pid : undefined
}

function readSupervisorPid(paths: ClaraPaths): number | undefined {
  try {
    const pid = Number.parseInt(readFileSync(paths.supervisorPidFile, 'utf8').trim(), 10)
    return Number.isInteger(pid) && pid > 0 ? pid : undefined
  } catch {
    return undefined
  }
}
