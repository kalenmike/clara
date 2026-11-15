import { spawn, spawnSync } from 'node:child_process'
import { closeSync, existsSync, openSync, readFileSync, unlinkSync } from 'node:fs'
import { setTimeout as delay } from 'node:timers/promises'
import { baseURL, dbPath, logPath, pidPath, type InstanceMode } from './config.ts'

export type ProbeMode = InstanceMode | 'unknown'

export type HealthProbe =
  | { status: 'current'; mode: ProbeMode; pid: number | null }
  | { status: 'foreign' }
  | { status: 'unreachable' }

export interface PidState {
  present: boolean
  pid: number | null
  alive: boolean
}

export type ServiceState =
  'local' | 'container' | 'external' | 'unresponsive' | 'foreign' | 'stopped'

export interface StatusReport {
  state: ServiceState
  url: string
  pid: number | null
  pidAlive: boolean
  stalePid: number | null
  log: string
}

export type StopResult =
  | { kind: 'stopped'; pid: number }
  | { kind: 'already-stopped'; stalePid: number | null }
  | { kind: 'not-exited'; pid: number }
  | { kind: 'container' }
  | { kind: 'external' }
  | { kind: 'foreign' }
  | { kind: 'error'; message: string }

export interface StartLocalOptions {
  /** Executable and arguments for the engine CLI, without the subcommand. */
  command: string[]
  /** Overrides health probing. Used by tests. */
  probe?: () => Promise<HealthProbe>
  /** Delay between health probes. */
  pollMs?: number
  /** Total time to wait for the local process to become healthy. */
  timeoutMs?: number
  /** Environment for the detached process. Defaults to this process's environment. */
  env?: NodeJS.ProcessEnv
}

export type StartLocalResult =
  | { kind: 'started' }
  | { kind: 'already-running'; mode: ProbeMode; pid: number | null }
  | { kind: 'unresponsive'; pid: number }
  | { kind: 'foreign' }
  | { kind: 'unhealthy' }

const ENGINE_PATTERNS = ['apps/engine', 'apps/orchestrator', 'clara-engine', 'clara-orchestrator']

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** Read a process command line without adding a dependency. */
function processCommand(pid: number): string | undefined {
  if (!Number.isInteger(pid) || pid <= 0) return undefined
  try {
    const raw = readFileSync(`/proc/${pid}/cmdline`).toString('utf8')
    const command = raw.split('\0').join(' ').trim()
    if (command) return command
  } catch {
    // Fall through to ps on hosts without procfs.
  }
  const result = spawnSync('ps', ['-p', String(pid), '-o', 'args='], {
    encoding: 'utf8',
    timeout: 3000,
  })
  if (result.error || result.status !== 0) return undefined
  const command = result.stdout.trim()
  return command || undefined
}

/** Whether a pid still looks like the engine service. */
function processMatches(pid: number, patterns: string[]): boolean | undefined {
  const command = processCommand(pid)
  if (!command) return undefined
  return patterns.some((pattern) => command.includes(pattern))
}

export function readPidState(): PidState {
  if (!existsSync(pidPath())) return { present: false, pid: null, alive: false }
  let raw: string
  try {
    raw = readFileSync(pidPath(), 'utf8').trim()
  } catch {
    return { present: false, pid: null, alive: false }
  }
  const pid = Number(raw)
  if (!Number.isInteger(pid) || pid <= 0) return { present: true, pid: null, alive: false }
  return { present: true, pid, alive: isAlive(pid) }
}

function removePid(): void {
  try {
    unlinkSync(pidPath())
  } catch {
    // Already gone.
  }
}

export async function probeHealth(url = baseURL()): Promise<HealthProbe> {
  let response: Response
  try {
    response = await fetch(`${url}/health`, { signal: AbortSignal.timeout(1500) })
  } catch {
    return { status: 'unreachable' }
  }
  if (!response.ok) return { status: 'unreachable' }

  let body: unknown
  try {
    body = await response.json()
  } catch {
    return { status: 'foreign' }
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { status: 'foreign' }

  const record = body as Record<string, unknown>
  if (record.service !== 'clara-engine' && record.service !== 'clara-orchestrator') {
    return { status: 'foreign' }
  }
  const mode = record.mode === 'local' || record.mode === 'container' ? record.mode : 'unknown'
  const pid =
    typeof record.pid === 'number' && Number.isInteger(record.pid) && record.pid > 0
      ? record.pid
      : null
  return { status: 'current', mode, pid }
}

/** Whether the responding service is the process named by the local pid file. */
function matchesLocalPid(probe: HealthProbe, pid: number | null): boolean {
  if (probe.status !== 'current') return true
  if (probe.mode === 'unknown' || probe.pid === null) return true
  return probe.pid === pid
}

export async function collectStatus(): Promise<StatusReport> {
  const probe = await probeHealth()
  const pid = readPidState()
  const stalePid = pid.present && !pid.alive ? pid.pid : null
  const base = {
    url: baseURL(),
    pid: pid.alive ? pid.pid : null,
    pidAlive: pid.alive,
    stalePid,
    log: logPath(),
  }

  if (probe.status === 'current') {
    if (probe.mode === 'container') return { state: 'container', ...base }
    if (pid.alive && matchesLocalPid(probe, pid.pid)) return { state: 'local', ...base }
    return { state: 'external', ...base }
  }
  if (probe.status === 'foreign') return { state: 'foreign', ...base }
  if (pid.alive) return { state: 'unresponsive', ...base }
  return { state: 'stopped', ...base }
}

export function formatStatus(report: StatusReport): string[] {
  const lines: string[] = []

  if (report.state === 'local') {
    lines.push('service: running (local)')
  } else if (report.state === 'container') {
    lines.push('service: running (container)')
  } else if (report.state === 'external') {
    lines.push('service: running (external)')
  } else if (report.state === 'unresponsive') {
    lines.push(`service: not responding (local pid ${report.pid} is alive)`)
  } else if (report.state === 'foreign') {
    lines.push('service: not running (another service is using the port)')
  } else {
    lines.push('service: stopped')
  }

  lines.push(`url: ${report.url}`)

  if (report.state === 'container') {
    lines.push('pid: none (managed outside this installation)')
  } else if (report.stalePid !== null) {
    lines.push(`pid: ${report.stalePid} (stale; the process is gone)`)
  } else if (report.pid !== null) {
    lines.push(`pid: ${report.pid}`)
  } else {
    lines.push('pid: none')
  }

  if (report.state === 'container') {
    lines.push('database: unknown (managed outside this installation)')
    lines.push('stop: this engine is managed outside Clara; stop it where it was started')
  } else if (report.state === 'external') {
    lines.push('database: unknown (not this data directory)')
  } else if (report.state !== 'foreign') {
    lines.push(`database: ${dbPath()}`)
  }

  if (report.state === 'external') {
    lines.push('warning: no local pid file; this instance was not started from this data directory')
    lines.push('stop: `clara stop engine` signals the reported process')
  }
  if (report.state === 'unresponsive') {
    lines.push(`warning: the process is alive but ${report.url}/health did not respond`)
    lines.push(`log: ${report.log}`)
  }
  if (report.state === 'foreign') {
    lines.push(`warning: ${report.url} answered but did not identify as clara-engine`)
  }

  return lines
}

export function statusExitCode(report: StatusReport): number {
  const running =
    report.state === 'local' || report.state === 'container' || report.state === 'external'
  return running ? 0 : 1
}

async function waitForExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!isAlive(pid)) return true
    await delay(100)
  }
  return !isAlive(pid)
}

/** Stop a local pid, escalating to SIGKILL when SIGTERM does not land. */
async function terminateLocal(pid: number): Promise<StopResult> {
  try {
    process.kill(pid, 'SIGTERM')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') {
      removePid()
      return { kind: 'stopped', pid }
    }
    return {
      kind: 'error',
      message: error instanceof Error ? error.message : String(error),
    }
  }

  if (await waitForExit(pid, 5000)) {
    removePid()
    return { kind: 'stopped', pid }
  }

  try {
    process.kill(pid, 'SIGKILL')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') {
      return {
        kind: 'error',
        message: error instanceof Error ? error.message : String(error),
      }
    }
  }

  if (await waitForExit(pid, 3000)) {
    removePid()
    return { kind: 'stopped', pid }
  }
  return { kind: 'not-exited', pid }
}

/** Start a detached local service and wait for its health endpoint. */
export async function startLocalService(options: StartLocalOptions): Promise<StartLocalResult> {
  const probe = options.probe ?? (() => probeHealth())
  const initial = await probe()
  if (initial.status === 'current') {
    return { kind: 'already-running', mode: initial.mode, pid: initial.pid }
  }
  if (initial.status === 'foreign') return { kind: 'foreign' }

  const pid = readPidState()
  if (pid.alive && pid.pid !== null) return { kind: 'unresponsive', pid: pid.pid }

  const [executable, ...args] = options.command
  if (!executable) throw new Error('the engine entry command is empty')

  const out = openSync(logPath(), 'a', 0o600)
  try {
    const child = spawn(executable, [...args, 'serve', '--detached'], {
      detached: true,
      stdio: ['ignore', out, out],
      env: options.env ?? process.env,
    })
    child.unref()
  } finally {
    closeSync(out)
  }

  const timeoutMs = options.timeoutMs ?? 5_000
  const pollMs = options.pollMs ?? 100
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (pollMs > 0) await delay(pollMs)
    const next = await probe()
    if (next.status === 'current') return { kind: 'started' }
    if (next.status === 'foreign') return { kind: 'foreign' }
  }
  return { kind: 'unhealthy' }
}

export async function stopService(): Promise<StopResult> {
  const probe = await probeHealth()
  const pid = readPidState()
  const stalePid = pid.present && !pid.alive ? pid.pid : null

  if (probe.status === 'current' && probe.mode === 'container') {
    return { kind: 'container' }
  }

  if (probe.status === 'foreign') return { kind: 'foreign' }

  if (pid.alive && pid.pid !== null && matchesLocalPid(probe, pid.pid)) {
    return terminateLocal(pid.pid)
  }

  // A local instance started from another data directory (or by the panel or a
  // maintenance restart) has no pid file here. The health response names its
  // process, so stop it when the command line still looks like Clara.
  if (probe.status === 'current' && probe.mode !== 'container' && probe.pid !== null) {
    if (isAlive(probe.pid) && processMatches(probe.pid, ENGINE_PATTERNS) !== false) {
      return terminateLocal(probe.pid)
    }
  }

  if (probe.status === 'current') return { kind: 'external' }

  if (pid.present) removePid()
  return { kind: 'already-stopped', stalePid }
}
