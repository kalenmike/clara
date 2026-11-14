import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { isRuntimeLive, readRuntimeState } from '@clara/runtime-state'

export function apiURL(): string {
  const configured = process.env.CLARA_API_URL?.trim()
  if (configured) return configured.replace(/\/$/, '')
  const state = readRuntimeState()
  if (state && isRuntimeLive(state) && state.local) return state.local.url.replace(/\/$/, '')
  return 'http://127.0.0.1:8788'
}

export function apiToken(): string {
  const configured = process.env.CLARA_API_TOKEN?.trim()
  if (configured) return configured

  const explicit = process.env.CLARA_API_TOKEN_FILE?.trim()
  if (explicit) return readToken(explicit)

  const configHome = process.env.XDG_CONFIG_HOME?.trim() || join(homedir(), '.config')
  const configDir = process.env.CLARA_CONFIG_DIR?.trim() || join(configHome, 'clara')
  return readToken(join(configDir, 'api.token'))
}

function readToken(path: string): string {
  if (!existsSync(path)) return ''
  return readFileSync(path, 'utf8').trim()
}
