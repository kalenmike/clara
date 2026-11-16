import { randomBytes } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

/** Read a Clara engine variable, falling back to its historical name. */
function engineEnv(name: string, legacy: string): string | undefined {
  return process.env[name]?.trim() || process.env[legacy]?.trim()
}

export function dataDir(): string {
  const configured = process.env.CLARA_DATA_DIR?.trim()
  if (configured) return configured
  const xdg = process.env.XDG_DATA_HOME?.trim() || join(homedir(), '.local', 'share')
  return join(xdg, 'clara')
}

export function tokenPath(): string {
  return (
    engineEnv('CLARA_ENGINE_TOKEN_FILE', 'CLARA_ORCHESTRATION_TOKEN_FILE') ||
    join(dataDir(), 'engine.token')
  )
}

/** The pre-rename token file. Read for one release so existing installs keep working. */
export function legacyTokenPath(): string {
  return join(dataDir(), 'orchestrator.token')
}

export function dbPath(): string {
  const configured = engineEnv('CLARA_ENGINE_DB_PATH', 'CLARA_ORCHESTRATION_DB_PATH')
  if (configured) return configured
  const path = join(dataDir(), 'engine.db')
  const legacy = join(dataDir(), 'orchestration.db')
  if (!existsSync(path) && existsSync(legacy)) {
    try {
      renameSync(legacy, path)
      return path
    } catch {
      // A read-only or cross-device data directory keeps the old name.
      return legacy
    }
  }
  return path
}

export function pidPath(): string {
  const path = join(dataDir(), 'engine.pid')
  const legacy = join(dataDir(), 'orchestrator.pid')
  return !existsSync(path) && existsSync(legacy) ? legacy : path
}

/**
 * Whether this process runs inside a container. The image sets
 * CLARA_ENGINE_CONTAINER=1 so a host-side status probe can tell a container
 * apart from a local PID.
 */
export function containerized(): boolean {
  const value = engineEnv('CLARA_ENGINE_CONTAINER', 'CLARA_ORCHESTRATION_CONTAINER')?.toLowerCase()
  return value === '1' || value === 'true' || value === 'yes'
}

export type InstanceMode = 'local' | 'container'

export function instanceMode(): InstanceMode {
  return containerized() ? 'container' : 'local'
}

export function logPath(): string {
  return join(dataDir(), 'engine.log')
}

export function ensureToken(): string {
  const configured = engineEnv('CLARA_ENGINE_TOKEN', 'CLARA_ORCHESTRATION_TOKEN')
  if (configured) return configured

  const explicit = engineEnv('CLARA_ENGINE_TOKEN_FILE', 'CLARA_ORCHESTRATION_TOKEN_FILE')
  const path = explicit || tokenPath()
  if (existsSync(path)) {
    const token = readFileSync(path, 'utf8').trim()
    if (token) return token
  }

  // Read the pre-rename file in place; only a new install writes engine.token.
  if (!explicit) {
    const legacy = legacyTokenPath()
    if (existsSync(legacy)) {
      const token = readFileSync(legacy, 'utf8').trim()
      if (token) return token
    }
  }

  mkdirSync(dataDir(), { recursive: true, mode: 0o700 })
  const token = randomBytes(32).toString('hex')
  writeFileSync(path, `${token}\n`, { mode: 0o600 })
  try {
    chmodSync(path, 0o600)
  } catch {
    // Best effort on platforms without POSIX modes.
  }
  return token
}

export function port(): number {
  const configured = Number(engineEnv('CLARA_ENGINE_PORT', 'CLARA_ORCHESTRATION_PORT') ?? 8789)
  return Number.isInteger(configured) && configured > 0 ? configured : 8789
}

export function host(): string {
  return engineEnv('CLARA_ENGINE_HOST', 'CLARA_ORCHESTRATION_HOST') || '127.0.0.1'
}

export function baseURL(): string {
  return `http://${host()}:${port()}`
}

/**
 * The URL a local client uses to call the engine. A wildcard bind address is
 * not dialable, so loopback replaces it; an explicit client URL wins.
 */
export function clientURL(): string {
  const configured = engineEnv('CLARA_ENGINE_CLIENT_URL', 'CLARA_ORCHESTRATION_CLIENT_URL')
  if (configured) return configured.replace(/\/$/, '')
  const bind = host()
  const wildcard = bind === '0.0.0.0' || bind === '::' || bind === '[::]'
  return `http://${wildcard ? '127.0.0.1' : bind}:${port()}`
}

export function configPath(): string | undefined {
  return engineEnv('CLARA_ENGINE_CONFIG', 'CLARA_ORCHESTRATION_CONFIG') || undefined
}

export function workspace(): string {
  const configured = engineEnv('CLARA_ENGINE_WORKSPACE', 'CLARA_ORCHESTRATION_WORKSPACE')
  return resolve(configured || process.cwd())
}
