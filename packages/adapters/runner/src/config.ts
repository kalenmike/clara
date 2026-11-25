import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export interface RunnerConfigFile {
  url: string
  workspace: string
  concurrency: number
  labels: string[]
}

export function claraConfigDir(env: NodeJS.ProcessEnv = process.env): string {
  const xdg = env.XDG_CONFIG_HOME?.trim() || join(homedir(), '.config')
  return join(xdg, 'clara')
}

export function claraDataDir(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.CLARA_DATA_DIR?.trim()
  if (configured) return configured
  const xdg = env.XDG_DATA_HOME?.trim() || join(homedir(), '.local', 'share')
  return join(xdg, 'clara')
}

export type EngineEndpointFile = {
  enabled: boolean
  mode: 'direct' | 'proxy' | 'none'
  url?: string
  token?: string
}

export function readEngineEndpoint(
  env: NodeJS.ProcessEnv = process.env
): EngineEndpointFile | undefined {
  const path = join(claraDataDir(env), 'engine.json')
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

export function engineURL(env: NodeJS.ProcessEnv = process.env): string {
  return (
    env.CLARA_ENGINE_URL?.trim() ||
    env.CLARA_ORCHESTRATION_URL?.trim() ||
    readEngineEndpoint(env)?.url ||
    'http://127.0.0.1:8789'
  ).replace(/\/$/, '')
}

export function engineToken(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.CLARA_ENGINE_TOKEN?.trim() || env.CLARA_ORCHESTRATION_TOKEN?.trim()
  if (configured) return configured
  const endpoint = readEngineEndpoint(env)
  const explicit = env.CLARA_ENGINE_TOKEN_FILE?.trim() || env.CLARA_ORCHESTRATION_TOKEN_FILE?.trim()
  const path = explicit || join(claraDataDir(env), 'engine.token')
  const token = existsSync(path) ? readFileSync(path, 'utf8').trim() : ''
  if (endpoint?.mode === 'proxy' && endpoint.token) return endpoint.token
  if (token || explicit) return token
  if (endpoint?.token) return endpoint.token
  const legacy = join(claraDataDir(env), 'orchestrator.token')
  return existsSync(legacy) ? readFileSync(legacy, 'utf8').trim() : ''
}

export function runnerConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(claraConfigDir(env), 'runner.json')
}

export function readRunnerConfig(path: string): RunnerConfigFile | undefined {
  if (!existsSync(path)) return undefined
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<RunnerConfigFile>
    if (
      typeof parsed.url !== 'string' ||
      typeof parsed.workspace !== 'string' ||
      typeof parsed.concurrency !== 'number'
    ) {
      return undefined
    }
    return {
      url: parsed.url,
      workspace: parsed.workspace,
      concurrency: parsed.concurrency,
      labels: Array.isArray(parsed.labels)
        ? parsed.labels.filter((label): label is string => typeof label === 'string')
        : [],
    }
  } catch {
    return undefined
  }
}

export function writeRunnerConfig(path: string, config: RunnerConfigFile): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const temp = `${path}.tmp`
  writeFileSync(temp, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 })
  renameSync(temp, path)
}
