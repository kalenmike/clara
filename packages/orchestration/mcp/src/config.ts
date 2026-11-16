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

type EngineEndpointFile = {
  enabled: boolean
  mode: 'direct' | 'proxy' | 'none'
  url?: string
  token?: string
}

export function readEngineEndpoint(): EngineEndpointFile | undefined {
  const path = join(dataDir(), 'engine.json')
  if (!existsSync(path)) return undefined
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<EngineEndpointFile>
    if (
      typeof parsed.enabled !== 'boolean' ||
      (parsed.mode !== 'direct' && parsed.mode !== 'proxy' && parsed.mode !== 'none')
    ) {
      return undefined
    }
    return {
      enabled: parsed.enabled,
      mode: parsed.mode,
      ...(typeof parsed.url === 'string' && parsed.url ? { url: parsed.url } : {}),
      ...(typeof parsed.token === 'string' && parsed.token ? { token: parsed.token } : {}),
    }
  } catch {
    return undefined
  }
}

export function serviceURL(): string {
  return (
    engineEnv('CLARA_ENGINE_URL', 'CLARA_ORCHESTRATION_URL') ||
    readEngineEndpoint()?.url ||
    'http://127.0.0.1:8789'
  ).replace(/\/$/, '')
}

function tokenFile(path: string): string {
  if (!existsSync(path)) return ''
  return readFileSync(path, 'utf8').trim()
}

export function token(): string {
  const configured = engineEnv('CLARA_ENGINE_TOKEN', 'CLARA_ORCHESTRATION_TOKEN')
  if (configured) return configured
  const endpoint = readEngineEndpoint()
  const explicit = engineEnv('CLARA_ENGINE_TOKEN_FILE', 'CLARA_ORCHESTRATION_TOKEN_FILE')
  if (explicit) return tokenFile(explicit)
  const file = tokenFile(tokenPath()) || tokenFile(legacyTokenPath())
  if (endpoint?.mode === 'proxy' && endpoint.token) return endpoint.token
  return file || endpoint?.token || ''
}

export function autostart(): boolean {
  const value = String(
    engineEnv('CLARA_ENGINE_AUTOSTART', 'CLARA_ORCHESTRATION_AUTOSTART') ?? '1'
  ).toLowerCase()
  if (value === '0' || value === 'false' || value === 'off') return false
  // A panel-installed adapter has a resolved endpoint (direct or proxy). Do not
  // start a second local engine on that machine.
  return readEngineEndpoint() === undefined
}
