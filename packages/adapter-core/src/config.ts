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

/** Resolve the orchestrator URL and bearer token from the environment. */
export function orchestrationServiceConfig(env: NodeJS.ProcessEnv = process.env): ServiceConfig {
  const url = (env.CLARA_ORCHESTRATION_URL?.trim() || 'http://127.0.0.1:8789').replace(/\/$/, '')
  const configured = env.CLARA_ORCHESTRATION_TOKEN?.trim()
  if (configured) return { url, token: configured }
  const path =
    env.CLARA_ORCHESTRATION_TOKEN_FILE?.trim() || join(claraDataDir(env), 'orchestrator.token')
  const token = existsSync(path) ? readFileSync(path, 'utf8').trim() : ''
  return { url, token }
}
