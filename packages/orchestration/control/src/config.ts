import { randomBytes } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

export function dataDir(): string {
  const configured = process.env.CLARA_DATA_DIR?.trim()
  if (configured) return configured
  const xdg = process.env.XDG_DATA_HOME?.trim() || join(homedir(), '.local', 'share')
  return join(xdg, 'clara')
}

export function tokenPath(): string {
  return process.env.CLARA_ORCHESTRATION_TOKEN_FILE?.trim() || join(dataDir(), 'orchestrator.token')
}

export function dbPath(): string {
  return process.env.CLARA_ORCHESTRATION_DB_PATH?.trim() || join(dataDir(), 'orchestration.db')
}

export function pidPath(): string {
  return join(dataDir(), 'orchestrator.pid')
}

/**
 * Whether this process runs inside a container. The image sets
 * CLARA_ORCHESTRATION_CONTAINER=1 so a host-side status probe can tell a
 * container apart from a local PID.
 */
export function containerized(): boolean {
  const value = process.env.CLARA_ORCHESTRATION_CONTAINER?.trim().toLowerCase()
  return value === '1' || value === 'true' || value === 'yes'
}

export type InstanceMode = 'local' | 'container'

export function instanceMode(): InstanceMode {
  return containerized() ? 'container' : 'local'
}

export function logPath(): string {
  return join(dataDir(), 'orchestrator.log')
}

export function ensureToken(): string {
  const configured = process.env.CLARA_ORCHESTRATION_TOKEN?.trim()
  if (configured) return configured
  const path = tokenPath()
  if (existsSync(path)) {
    const token = readFileSync(path, 'utf8').trim()
    if (token) return token
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
  const configured = Number(process.env.CLARA_ORCHESTRATION_PORT ?? 8789)
  return Number.isInteger(configured) && configured > 0 ? configured : 8789
}

export function host(): string {
  return process.env.CLARA_ORCHESTRATION_HOST?.trim() || '127.0.0.1'
}

export function baseURL(): string {
  return `http://${host()}:${port()}`
}

export function configPath(): string | undefined {
  return process.env.CLARA_ORCHESTRATION_CONFIG?.trim() || undefined
}

export function workspace(): string {
  const configured = process.env.CLARA_ORCHESTRATION_WORKSPACE?.trim()
  return resolve(configured || process.cwd())
}
