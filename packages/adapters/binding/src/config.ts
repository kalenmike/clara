import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

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

function envValue(
  env: NodeJS.ProcessEnv,
  name: string,
  legacy: string
): string | undefined {
  return env[name]?.trim() || env[legacy]?.trim()
}

/** Resolve the engine URL and bearer token from the environment. */
export function engineServiceConfig(env: NodeJS.ProcessEnv = process.env): ServiceConfig {
  const url = (
    envValue(env, 'CLARA_ENGINE_URL', 'CLARA_ORCHESTRATION_URL') || 'http://127.0.0.1:8789'
  ).replace(/\/$/, '')
  const configured = envValue(env, 'CLARA_ENGINE_TOKEN', 'CLARA_ORCHESTRATION_TOKEN')
  if (configured) return { url, token: configured }

  const explicit = envValue(
    env,
    'CLARA_ENGINE_TOKEN_FILE',
    'CLARA_ORCHESTRATION_TOKEN_FILE'
  )
  const path = explicit || join(claraDataDir(env), 'engine.token')
  let token = existsSync(path) ? readFileSync(path, 'utf8').trim() : ''
  if (!token && !explicit) {
    const legacy = join(claraDataDir(env), 'orchestrator.token')
    token = existsSync(legacy) ? readFileSync(legacy, 'utf8').trim() : ''
  }
  return { url, token }
}

/** @deprecated Use engineServiceConfig. */
export const orchestrationServiceConfig = engineServiceConfig
