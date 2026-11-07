import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export function dataDir(): string {
  const configured = process.env.CLARA_DATA_DIR?.trim()
  if (configured) return configured
  const xdg = process.env.XDG_DATA_HOME?.trim() || join(homedir(), '.local', 'share')
  return join(xdg, 'clara')
}

export function tokenPath(): string {
  return process.env.CLARA_ORCHESTRATION_TOKEN_FILE?.trim() || join(dataDir(), 'orchestrator.token')
}

export function serviceURL(): string {
  return (process.env.CLARA_ORCHESTRATION_URL?.trim() || 'http://127.0.0.1:8789').replace(/\/$/, '')
}

export function token(): string {
  const configured = process.env.CLARA_ORCHESTRATION_TOKEN?.trim()
  if (configured) return configured
  const path = tokenPath()
  if (existsSync(path)) return readFileSync(path, 'utf8').trim()
  return ''
}

export function autostart(): boolean {
  const value = String(process.env.CLARA_ORCHESTRATION_AUTOSTART ?? '1').toLowerCase()
  return value !== '0' && value !== 'false' && value !== 'off'
}
