// Detached local Clara processes.
//
// `clara start --local` and the `--local` service commands run beside the
// Docker stack. Each process gets a PID file and a log under the Clara data
// directory so status, stop, restart, and logs can find it later. A service may
// also be started by another path (for example `clara rebuild`), so stop
// falls back to the service's own runtime state or health PID, then to the
// listening port, before giving up.

import { spawn, spawnSync } from 'node:child_process'
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fail } from './router.mjs'

export function stateDir(env = process.env) {
  const configured = env.CLARA_DATA_DIR?.trim()
  if (configured) return configured
  const dataHome = env.XDG_DATA_HOME?.trim() || join(homedir(), '.local', 'share')
  return join(dataHome, 'clara')
}

export function pidPath(name, env = process.env) {
  return join(stateDir(env), `${name}.pid`)
}

export function logPath(name, env = process.env) {
  return join(stateDir(env), `${name}.log`)
}

/** Docker is the default; both flags are accepted so scripts can be explicit. */
export function parseMode(args) {
  const local = args.includes('--local')
  const docker = args.includes('--docker')
  if (local && docker) throw new Error('--local and --docker cannot be combined')
  return local ? 'local' : 'docker'
}

export function processAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}

export function readPid(name, env = process.env) {
  const path = pidPath(name, env)
  if (!existsSync(path)) return { present: false, pid: null, alive: false }
  const raw = readFileSync(path, 'utf8').trim()
  const pid = Number.parseInt(raw, 10)
  if (!Number.isInteger(pid) || pid <= 0) return { present: true, pid: null, alive: false }
  return { present: true, pid, alive: processAlive(pid) }
}

function removePid(name, env = process.env) {
  try {
    unlinkSync(pidPath(name, env))
  } catch {
    // Already gone.
  }
}

/** Record a running service's pid so a later `stop --local` can find it. */
export function recordPid(name, pid, env = process.env) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  writePid(name, pid, env)
  return true
}

function ensureStateDir(env = process.env) {
  mkdirSync(stateDir(env), { recursive: true, mode: 0o700 })
}

function writePid(name, pid, env = process.env) {
  ensureStateDir(env)
  writeFileSync(pidPath(name, env), `${pid}\n`, { mode: 0o600 })
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitFor(check, timeoutMs, pollMs = 250) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await check()) return true
    await sleep(pollMs)
  }
  return false
}

export async function waitForExit(pid, timeoutMs = 5_000) {
  return waitFor(() => !processAlive(pid), timeoutMs, 100)
}

/** Whether this process may safely send a signal to the pid. */
export function canSignal(pid) {
  if (!Number.isInteger(pid) || pid <= 1) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** Read a process command line without adding a dependency. */
export function processCommand(pid) {
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

/** Whether a pid still looks like the service that was captured. */
export function processMatches(pid, patterns) {
  const command = processCommand(pid)
  if (!command) return undefined
  return patterns.some((pattern) => command.includes(pattern))
}

/** Read a process environment on Linux so a manual restart keeps secrets. */
export function readProcessEnv(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return undefined
  try {
    const raw = readFileSync(`/proc/${pid}/environ`).toString('utf8')
    const env = {}
    for (const entry of raw.split('\0')) {
      if (!entry) continue
      const index = entry.indexOf('=')
      if (index > 0) env[entry.slice(0, index)] = entry.slice(index + 1)
    }
    return Object.keys(env).length > 0 ? env : undefined
  } catch {
    return undefined
  }
}

/** Read-only systemd check; stop never changes a unit's state itself. */
export function systemdUnitActive(unit = 'clara') {
  const result = spawnSync('systemctl', ['--user', 'is-active', unit], {
    encoding: 'utf8',
    timeout: 3000,
  })
  if (result.error) return undefined
  return result.status === 0 && result.stdout.trim() === 'active'
}

export function parseSsListeners(output, port) {
  for (const line of String(output ?? '').split('\n')) {
    if (!line.includes(`:${port} `)) continue
    const match = line.match(/pid=(\d+)/)
    if (match) return Number(match[1])
  }
  return undefined
}

export function parseLsofPids(output) {
  for (const line of String(output ?? '').split('\n')) {
    const pid = Number(line.trim())
    if (Number.isInteger(pid) && pid > 0) return pid
  }
  return undefined
}

export function parseFuserPid(output) {
  const text = String(output ?? '')
  const afterPort = text.match(/:\s*(\d+)/)
  if (afterPort) return Number(afterPort[1])
  const match = text.match(/\b(\d+)\b/)
  return match ? Number(match[1]) : undefined
}

/** Find the process listening on a loopback port without adding a dependency. */
export function findListenerPid(port) {
  if (!Number.isInteger(port) || port <= 0) return undefined

  const ss = spawnSync('ss', ['-ltnp'], { encoding: 'utf8', timeout: 3000 })
  if (!ss.error && ss.status === 0) {
    const pid = parseSsListeners(ss.stdout, port)
    if (pid !== undefined) return pid
  }

  const lsof = spawnSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], {
    encoding: 'utf8',
    timeout: 3000,
  })
  if (!lsof.error && lsof.status === 0) {
    const pid = parseLsofPids(lsof.stdout)
    if (pid !== undefined) return pid
  }

  const fuser = spawnSync('fuser', [`${port}/tcp`], { encoding: 'utf8', timeout: 3000 })
  if (!fuser.error) {
    const pid = parseFuserPid(`${fuser.stdout ?? ''} ${fuser.stderr ?? ''}`)
    if (pid !== undefined) return pid
  }
  return undefined
}

/**
 * Start a detached local process unless it is already healthy. `healthy` is an
 * async predicate that probes the service; callers own the health contract.
 */
export async function startDetached({
  name,
  command,
  args,
  cwd,
  env = process.env,
  healthy,
  timeoutMs = 60_000,
}) {
  if (healthy && (await healthy())) return { status: 'running' }

  const previous = readPid(name, env)
  if (previous.alive) return { status: 'unresponsive', pid: previous.pid }
  if (previous.present) removePid(name, env)

  ensureStateDir(env)
  const out = openSync(logPath(name, env), 'a', 0o600)
  let child
  try {
    child = spawn(command, args, {
      cwd,
      env,
      detached: true,
      stdio: ['ignore', out, out],
    })
    child.unref()
  } finally {
    closeSync(out)
  }
  if (!child.pid) return { status: 'failed', reason: 'the process did not start' }
  writePid(name, child.pid, env)

  const started = await waitFor(async () => {
    if (child.exitCode !== null || child.signalCode !== null) return false
    return healthy ? healthy() : processAlive(child.pid)
  }, timeoutMs)

  if (started) return { status: 'started', pid: child.pid }

  const alive = processAlive(child.pid)
  if (!alive) removePid(name, env)
  return {
    status: 'unhealthy',
    pid: child.pid,
    alive,
    log: logPath(name, env),
    reason: alive ? 'the process did not answer its health check' : 'the process exited',
  }
}

function collectCandidates(recorded, discovered, ports) {
  const candidates = []
  const seen = new Set()
  const push = (pid, source, trusted) => {
    if (!Number.isInteger(pid) || pid <= 0 || seen.has(pid)) return
    seen.add(pid)
    candidates.push({ pid, source, trusted })
  }

  if (recorded.pid !== null) push(recorded.pid, 'pid file', true)
  for (const entry of Array.isArray(discovered) ? discovered : [discovered]) {
    if (entry === undefined || entry === null) continue
    if (typeof entry === 'number') push(entry, 'service state', true)
    else if (typeof entry === 'object') {
      push(entry.pid, entry.source ?? 'service state', entry.trusted !== false)
    }
  }
  for (const port of ports) {
    const pid = findListenerPid(port)
    if (pid !== undefined) push(pid, `port ${port}`, false)
  }
  return candidates
}

async function terminate(pid, { timeoutMs, killTimeoutMs }) {
  try {
    process.kill(pid, 'SIGTERM')
  } catch (error) {
    if (error?.code === 'ESRCH') return { status: 'stopped', escalated: false }
    return {
      status: 'failed',
      reason: error instanceof Error ? error.message : String(error),
    }
  }

  if (await waitForExit(pid, timeoutMs)) return { status: 'stopped', escalated: false }

  try {
    process.kill(pid, 'SIGKILL')
  } catch (error) {
    if (error?.code === 'ESRCH') return { status: 'stopped', escalated: true }
    return {
      status: 'failed',
      reason: error instanceof Error ? error.message : String(error),
    }
  }

  if (await waitForExit(pid, killTimeoutMs)) return { status: 'stopped', escalated: true }
  return { status: 'not-exited', escalated: true }
}

/**
 * Stop the process recorded in the PID file, or one found through `discover`
 * or a listening port. Discovered and recorded PIDs are trusted unless their
 * command line positively identifies another process; port owners must match a
 * known pattern so an unrelated listener is never signalled.
 */
export async function stopDetached({
  name,
  timeoutMs = 10_000,
  killTimeoutMs = 3_000,
  env = process.env,
  patterns = [],
  ports = [],
  discover,
} = {}) {
  const recorded = readPid(name, env)
  const discovered = discover ? await discover() : []
  const candidates = collectCandidates(recorded, discovered, ports)
  let foreign

  for (const candidate of candidates) {
    if (!processAlive(candidate.pid)) continue
    const matches = patterns.length > 0 ? processMatches(candidate.pid, patterns) : undefined
    if (matches === false || (!candidate.trusted && matches !== true)) {
      foreign ??= {
        pid: candidate.pid,
        source: candidate.source,
        command: processCommand(candidate.pid),
      }
      continue
    }

    const result = await terminate(candidate.pid, { timeoutMs, killTimeoutMs })
    if (result.status === 'failed') {
      return { status: 'failed', pid: candidate.pid, reason: result.reason }
    }
    if (result.status === 'not-exited') {
      return { status: 'not-exited', pid: candidate.pid, escalated: true }
    }
    removePid(name, env)
    return {
      status: 'stopped',
      pid: candidate.pid,
      source: candidate.source,
      escalated: result.escalated === true,
    }
  }

  if (foreign) {
    removePid(name, env)
    return { status: 'foreign', ...foreign }
  }
  if (recorded.present) {
    removePid(name, env)
    return { status: 'stale', pid: recorded.pid }
  }
  return { status: 'not-running' }
}

/** Print the log from the start and keep following it until interrupted. */
export async function followLog(name, env = process.env) {
  const path = logPath(name, env)
  if (!existsSync(path)) {
    fail(`No ${name} log at ${path}. Start it with --local first.`)
  }

  let offset = 0
  const pump = () => {
    let stat
    try {
      stat = statSync(path)
    } catch {
      return
    }
    if (stat.size < offset) offset = 0
    if (stat.size <= offset) return
    const buffer = Buffer.alloc(stat.size - offset)
    const fd = openSync(path, 'r')
    try {
      readSync(fd, buffer, 0, buffer.length, offset)
    } finally {
      closeSync(fd)
    }
    offset = stat.size
    process.stdout.write(buffer)
  }

  pump()
  const timer = setInterval(pump, 500)
  await new Promise((resolve) => {
    const stop = () => {
      clearInterval(timer)
      resolve()
    }
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
  })
}
