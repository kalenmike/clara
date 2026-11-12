// Detached local Clara processes.
//
// `pnpm clara start --local` and the `--local` service commands run beside the
// Docker stack. Each process gets a PID file and a log under the Clara data
// directory so status, stop, restart, and logs can find it later.

import { spawn } from 'node:child_process'
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

/** Stop the process recorded in the PID file, if it is still alive. */
export async function stopDetached({ name, timeoutMs = 10_000, env = process.env }) {
  const pid = readPid(name, env)
  if (!pid.present) return { status: 'not-running' }
  if (!pid.alive || pid.pid === null) {
    removePid(name, env)
    return { status: 'stale', pid: pid.pid }
  }

  try {
    process.kill(pid.pid, 'SIGTERM')
  } catch (error) {
    if (error?.code === 'ESRCH') {
      removePid(name, env)
      return { status: 'stale', pid: pid.pid }
    }
    return {
      status: 'failed',
      pid: pid.pid,
      reason: error instanceof Error ? error.message : String(error),
    }
  }

  if (!(await waitFor(() => !processAlive(pid.pid), timeoutMs))) {
    return { status: 'not-exited', pid: pid.pid }
  }
  removePid(name, env)
  return { status: 'stopped', pid: pid.pid }
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
