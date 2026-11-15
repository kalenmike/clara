import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

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

/** The pre-rename token file, read for one release. */
function legacyTokenPath(): string {
  return join(dataDir(), 'orchestrator.token')
}

export function serviceURL(): string {
  return (
    engineEnv('CLARA_ENGINE_URL', 'CLARA_ORCHESTRATION_URL') || 'http://127.0.0.1:8789'
  ).replace(/\/$/, '')
}

function tokenFile(path: string): string {
  if (!existsSync(path)) return ''
  return readFileSync(path, 'utf8').trim()
}

export function token(): string {
  const configured = engineEnv('CLARA_ENGINE_TOKEN', 'CLARA_ORCHESTRATION_TOKEN')
  if (configured) return configured
  const explicit = engineEnv('CLARA_ENGINE_TOKEN_FILE', 'CLARA_ORCHESTRATION_TOKEN_FILE')
  if (explicit) return tokenFile(explicit)
  return tokenFile(tokenPath()) || tokenFile(legacyTokenPath())
}

export function autostart(): boolean {
  const value = String(
    engineEnv('CLARA_ENGINE_AUTOSTART', 'CLARA_ORCHESTRATION_AUTOSTART') ?? '1'
  ).toLowerCase()
  return value !== '0' && value !== 'false' && value !== 'off'
}
