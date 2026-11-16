import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export type EngineEndpointFile = {
  enabled: boolean
  mode: 'direct' | 'proxy' | 'none'
  url?: string
  token?: string
  updatedAt?: number
  reason?: string
}

export interface ServiceConfig {
  url: string
  token: string
}

export function claraDataDir(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.CLARA_DATA_DIR?.trim()
  if (configured) return configured
  const xdg = env.XDG_DATA_HOME?.trim() || join(homedir(), '.local', 'share')
  return join(xdg, 'clara')
}

function envValue(env: NodeJS.ProcessEnv, name: string, legacy: string): string | undefined {
  return env[name]?.trim() || env[legacy]?.trim()
}

export function engineConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(claraDataDir(env), 'engine.json')
}

/** Read the endpoint the adapter runtime resolved from the hub. */
export function readEngineEndpoint(
  env: NodeJS.ProcessEnv = process.env
): EngineEndpointFile | undefined {
  const path = engineConfigPath(env)
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
      ...(typeof parsed.updatedAt === 'number' ? { updatedAt: parsed.updatedAt } : {}),
      ...(typeof parsed.reason === 'string' && parsed.reason ? { reason: parsed.reason } : {}),
    }
  } catch {
    return undefined
  }
}

/**
 * Resolve the engine URL and bearer token. Environment values are the CI and
 * development override; a panel install writes engine.json instead.
 */
export function engineServiceConfig(env: NodeJS.ProcessEnv = process.env): ServiceConfig {
  const endpoint = readEngineEndpoint(env)
  const url = (
    envValue(env, 'CLARA_ENGINE_URL', 'CLARA_ORCHESTRATION_URL') ||
    endpoint?.url ||
    'http://127.0.0.1:8789'
  ).replace(/\/$/, '')
  const configured = envValue(env, 'CLARA_ENGINE_TOKEN', 'CLARA_ORCHESTRATION_TOKEN')
  if (configured) return { url, token: configured }

  const explicit = envValue(env, 'CLARA_ENGINE_TOKEN_FILE', 'CLARA_ORCHESTRATION_TOKEN_FILE')
  const path = explicit || join(claraDataDir(env), 'engine.token')
  let token = existsSync(path) ? readFileSync(path, 'utf8').trim() : ''
  if (!token && !explicit) {
    const legacy = join(claraDataDir(env), 'orchestrator.token')
    token = existsSync(legacy) ? readFileSync(legacy, 'utf8').trim() : ''
  }
  // Proxy mode uses the local gateway token, not a stale engine credential.
  if (endpoint?.mode === 'proxy' && endpoint.token) token = endpoint.token
  else if (!token && endpoint?.token) token = endpoint.token
  return { url, token }
}
