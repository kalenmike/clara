import { spawn, spawnSync } from 'node:child_process'
import { closeSync, existsSync, openSync, readFileSync, unlinkSync } from 'node:fs'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
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

export interface StopOptions {
  /** Stop the compose-managed container instead of only printing a hint. */
  docker?: boolean
  /** Overrides the compose command. Used by tests. */
  composeDown?: () => Promise<ComposeResult>
}

export interface StartDockerOptions {
  /** Rebuild the image before starting the service. */
  build?: boolean
  /** Overrides the compose command. Used by tests. */
  composeUp?: (build: boolean) => Promise<ComposeResult>
  /** Overrides health probing. Used by tests. */
  probe?: () => Promise<HealthProbe>
  /** Delay between health probes. */
  pollMs?: number
  /** Total time to wait for the container to become healthy. */
  timeoutMs?: number
}

export interface ComposeResult {
  ok: boolean
  code: number | null
  error?: string
}

export type ComposeAction = 'up' | 'down'

export type StopResult =
  | { kind: 'stopped'; pid: number }
  | { kind: 'already-stopped'; stalePid: number | null }
  | { kind: 'not-exited'; pid: number }
  | { kind: 'container' }
  | { kind: 'container-down'; result: ComposeResult; detected: boolean }
  | { kind: 'external' }
  | { kind: 'foreign' }
  | { kind: 'error'; message: string }

export type StartDockerResult =
  | { kind: 'container-started' }
  | { kind: 'container-running' }
  | { kind: 'local-running'; pid: number | null }
  | { kind: 'external' }
  | { kind: 'foreign' }
  | { kind: 'compose-failed'; result: ComposeResult }
  | { kind: 'unhealthy' }

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
    lines.push('service: running (docker container)')
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
    lines.push('pid: none (managed by the container)')
  } else if (report.stalePid !== null) {
    lines.push(`pid: ${report.stalePid} (stale; the process is gone)`)
  } else if (report.pid !== null) {
    lines.push(`pid: ${report.pid}`)
  } else {
    lines.push('pid: none')
  }

  if (report.state === 'container') {
    const bind =
      process.env.CLARA_ENGINE_DATA_DIR?.trim() || process.env.CLARA_ORCHESTRATOR_DATA_DIR?.trim()
    lines.push(
      bind
        ? 'database: managed by the container (host bind from CLARA_ENGINE_DATA_DIR)'
        : 'database: managed by the container (Docker volume clara-orchestrator-data)'
    )
    lines.push('stop: clara stop engine --docker')
  } else if (report.state === 'external') {
    lines.push('database: unknown (not this data directory)')
  } else if (report.state !== 'foreign') {
    lines.push(`database: ${dbPath()}`)
  }

  if (report.state === 'external') {
    lines.push('warning: no local pid file; this instance was not started from this data directory')
    lines.push('stop: `clara stop engine --local` signals the reported process')
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

function repoRoot(): string {
  return fileURLToPath(new URL('../../../..', import.meta.url))
}

export function composeArgs(action: ComposeAction, build = false): string[] {
  if (action === 'down') return ['compose', '-f', 'infra/docker/engine.compose.yml', 'down']
  const args = ['compose', '-f', 'infra/docker/engine.compose.yml', 'up', '-d']
  if (build) args.push('--build')
  args.push('engine')
  return args
}

export function composeLogArgs(tail = 40): string[] {
  return [
    'compose',
    '-f',
    'infra/docker/engine.compose.yml',
    'logs',
    '--tail',
    String(tail),
    'engine',
  ]
}

/** Recent container output, or an empty string when Docker is unavailable. */
export function readComposeLogs(tail = 40): string {
  const result = spawnSync('docker', composeLogArgs(tail), {
    cwd: repoRoot(),
    encoding: 'utf8',
    timeout: 5_000,
  })
  if (result.error) return ''
  return `${result.stdout ?? ''}${result.stderr ?? ''}`.trim()
}

/**
 * Compose interpolates the whole file, including `${VAR:?}` guards, even for
 * `down`. Down never reads the token or workspace, so fill the required values
 * with inert placeholders when they are not exported. `up` keeps the real
 * environment so a missing token still fails fast.
 *
 * The workspace placeholder must be an absolute path. Compose treats a short
 * volume source without a leading slash as a named volume, so a bare token like
 * `unused-by-compose-down` fails with `refers to undefined volume` before it
 * can remove the container.
 */
const DOWN_ENV_FALLBACKS = {
  CLARA_ENGINE_TOKEN: 'unused-by-compose-down',
  CLARA_WORKSPACE: repoRoot(),
} as const

export function composeEnv(
  action: ComposeAction,
  env: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
  if (action !== 'down') return env
  const result = { ...env }
  for (const [key, value] of Object.entries(DOWN_ENV_FALLBACKS)) {
    if (!result[key]) result[key] = value
  }
  return result
}

export function runCompose(action: ComposeAction, build = false): Promise<ComposeResult> {
  return new Promise((resolve) => {
    const child = spawn('docker', composeArgs(action, build), {
      cwd: repoRoot(),
      stdio: 'inherit',
      env: composeEnv(action),
    })
    child.once('error', (error) => resolve({ ok: false, code: null, error: error.message }))
    child.once('exit', (code) => resolve({ ok: code === 0, code }))
  })
}

export async function startDockerService(
  options: StartDockerOptions = {}
): Promise<StartDockerResult> {
  const probe = options.probe ?? (() => probeHealth())
  const initial = await probe()
  if (initial.status === 'current') {
    if (initial.mode === 'container') return { kind: 'container-running' }
    if (initial.mode === 'local') {
      const pid = readPidState()
      if (pid.alive && matchesLocalPid(initial, pid.pid)) {
        return { kind: 'local-running', pid: pid.pid }
      }
    }
    return { kind: 'external' }
  }
  if (initial.status === 'foreign') return { kind: 'foreign' }

  const up = options.composeUp ?? ((build: boolean) => runCompose('up', build))
  const result = await up(options.build ?? false)
  if (!result.ok) return { kind: 'compose-failed', result }

  const timeoutMs = options.timeoutMs ?? 30_000
  const pollMs = options.pollMs ?? 250
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const next = await probe()
    if (next.status === 'current') {
      if (next.mode === 'container' || next.mode === 'unknown') return { kind: 'container-started' }
      return { kind: 'foreign' }
    }
    if (next.status === 'foreign') return { kind: 'foreign' }
    if (pollMs > 0) await delay(pollMs)
  }
  return { kind: 'unhealthy' }
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

export async function stopService(options: StopOptions = {}): Promise<StopResult> {
  const probe = await probeHealth()
  const pid = readPidState()
  const stalePid = pid.present && !pid.alive ? pid.pid : null
  const composeDown = options.composeDown ?? (() => runCompose('down'))

  if (probe.status === 'current' && probe.mode === 'container') {
    if (!options.docker) return { kind: 'container' }
    return { kind: 'container-down', detected: true, result: await composeDown() }
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

  // An explicit docker stop also cleans up a container that is stopped or
  // unhealthy and therefore not answering /health.
  if (options.docker) {
    if (pid.present) removePid()
    return { kind: 'container-down', detected: false, result: await composeDown() }
  }

  if (pid.present) removePid()
  return { kind: 'already-stopped', stalePid }
}
