import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
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

/** Docker keeps its control token outside the local install data directory. */
function dockerTokenPath(): string {
  const configured = process.env.CLARA_DOCKER_STATE_DIR?.trim()
  if (configured) return join(resolve(configured), 'orchestrator.token')
  const xdg = process.env.XDG_DATA_HOME?.trim() || join(homedir(), '.local', 'share')
  return join(xdg, 'clara', 'docker', 'orchestrator.token')
}

export function serviceURL(): string {
  return (process.env.CLARA_ORCHESTRATION_URL?.trim() || 'http://127.0.0.1:8789').replace(/\/$/, '')
}

function dockerOrchestratorRunning(): boolean {
  const result = spawnSync(
    'docker',
    ['inspect', '--format', '{{.State.Running}}', 'clara-orchestrator'],
    { encoding: 'utf8', timeout: 3_000 }
  )
  return !result.error && result.status === 0 && result.stdout.trim() === 'true'
}

function tokenFile(path: string): string {
  if (!existsSync(path)) return ''
  return readFileSync(path, 'utf8').trim()
}

export function token(): string {
  const configured = process.env.CLARA_ORCHESTRATION_TOKEN?.trim()
  if (configured) return configured
  const explicit = process.env.CLARA_ORCHESTRATION_TOKEN_FILE?.trim()
  if (explicit) return tokenFile(explicit)
  if (dockerOrchestratorRunning()) {
    const dockerToken = tokenFile(dockerTokenPath())
    if (dockerToken) return dockerToken
  }
  return tokenFile(tokenPath())
}

export function autostart(): boolean {
  const value = String(process.env.CLARA_ORCHESTRATION_AUTOSTART ?? '1').toLowerCase()
  return value !== '0' && value !== 'false' && value !== 'off'
}
