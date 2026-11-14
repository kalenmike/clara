import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

const SCHEMA = 1
const LOCK_SUFFIX = '.lock'

/**
 * Resolve the discovery file. The hub, CLI, MCP, and desktop shells must all
 * agree on this path, so it is deliberately independent of the hub's config and
 * data directories. `CLARA_RUNTIME_FILE` wins for tests and custom installs.
 */
export function runtimeFile(env = process.env) {
  const configured = env.CLARA_RUNTIME_FILE?.trim()
  if (configured) return configured

  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'Clara', 'runtime.json')
  }
  if (process.platform === 'win32') {
    const base =
      env.LOCALAPPDATA?.trim() || env.APPDATA?.trim() || join(homedir(), 'AppData', 'Local')
    return join(base, 'Clara', 'runtime.json')
  }

  const runtime = env.XDG_RUNTIME_DIR?.trim()
  if (runtime) return join(runtime, 'clara', 'runtime.json')
  const data = env.XDG_DATA_HOME?.trim() || join(homedir(), '.local', 'share')
  return join(data, 'clara', 'runtime.json')
}

export function readRuntimeState(file = runtimeFile()) {
  try {
    if (!existsSync(file)) return undefined
    const value = JSON.parse(readFileSync(file, 'utf8'))
    return validate(value)
  } catch {
    return undefined
  }
}

export function writeRuntimeState(state, file = runtimeFile()) {
  const next = validate(state)
  if (!next) throw new Error('Invalid runtime state')
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
  const temp = `${file}.${process.pid}.tmp`
  writeFileSync(temp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 })
  try {
    renameSync(temp, file)
  } catch (cause) {
    rmSync(temp, { force: true })
    throw cause
  }
  return file
}

/** Keep the last ports as a hint, but make the state clearly not live. */
export function stopRuntimeState(file = runtimeFile()) {
  const current = readRuntimeState(file)
  if (!current) return
  try {
    writeRuntimeState(
      {
        ...current,
        state: 'stopped',
        updatedAt: new Date().toISOString(),
      },
      file
    )
  } catch {
    // Shutdown must not fail because the runtime file is unwritable.
  }
}

export function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (cause) {
    return cause?.code === 'EPERM'
  }
}

export function isRuntimeLive(state) {
  return Boolean(state && state.state === 'running' && isProcessAlive(state.pid))
}

/**
 * A single hub owns one runtime file. The lock directory is atomic on every
 * platform; a dead PID is treated as stale and removed.
 */
export function acquireRuntimeLock(file = runtimeFile()) {
  const path = `${file}${LOCK_SUFFIX}`
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      mkdirSync(path, { mode: 0o700 })
      writeFileSync(join(path, 'pid'), `${process.pid}\n`, { mode: 0o600 })
      return {
        acquired: true,
        path,
        release: () => rmSync(path, { recursive: true, force: true }),
      }
    } catch (cause) {
      if (cause?.code !== 'EEXIST') throw cause
      const owner = readLockPid(path)
      if (owner && isProcessAlive(owner)) {
        return { acquired: false, path, pid: owner }
      }
      rmSync(path, { recursive: true, force: true })
    }
  }

  return { acquired: false, path }
}

function readLockPid(path) {
  try {
    const value = Number.parseInt(readFileSync(join(path, 'pid'), 'utf8').trim(), 10)
    return Number.isInteger(value) && value > 0 ? value : undefined
  } catch {
    return undefined
  }
}

function validate(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const state = value
  if (state.schema !== SCHEMA) return undefined
  if (state.state !== 'running' && state.state !== 'stopped') return undefined
  if (!Number.isInteger(state.pid) || state.pid <= 0) return undefined
  if (typeof state.startedAt !== 'string' || typeof state.updatedAt !== 'string') return undefined
  if (typeof state.version !== 'string') return undefined
  if (state.mode !== 'local' && state.mode !== 'container') return undefined
  if (typeof state.configDir !== 'string' || typeof state.dataDir !== 'string') return undefined

  const local = endpoint(state.local, true)
  if (state.local !== undefined && !local) return undefined
  const panel = endpoint(state.panel, false)
  if (state.panel !== undefined && !panel) return undefined

  return {
    schema: SCHEMA,
    state: state.state,
    pid: state.pid,
    startedAt: state.startedAt,
    updatedAt: state.updatedAt,
    version: state.version,
    mode: state.mode,
    configDir: state.configDir,
    dataDir: state.dataDir,
    ...(local ? { local } : {}),
    ...(panel ? { panel } : {}),
  }
}

function endpoint(value, websocket) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const host = typeof value.host === 'string' ? value.host.trim() : ''
  const port = Number(value.port)
  const url = typeof value.url === 'string' ? value.url.trim() : ''
  if (!host || !Number.isInteger(port) || port < 1 || port > 65_535) return undefined
  if (!url) return undefined
  if (websocket) {
    const wsUrl = typeof value.wsUrl === 'string' ? value.wsUrl.trim() : ''
    if (!wsUrl) return undefined
    return { host, port, url, wsUrl }
  }
  return { host, port, url }
}
