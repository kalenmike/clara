import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import {
  adapterPaths,
  loadIdentity as loadAdapterIdentity,
  readAdapterConfig,
  removeAdapterConfig,
  removeIdentity as removeAdapterIdentity,
  writeAdapterConfig,
} from '@clara/adapter-runtime'
import type { AdapterConfig as GenericAdapterConfig, AdapterIdentity } from '@clara/adapter-runtime'

export type PiThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'

/**
 * How the adapter handles Pi project trust. `inherit` uses the same saved
 * decisions and `defaultProjectTrust` setting as the Pi CLI. `always` and
 * `never` pass `--approve` / `--no-approve` for every session.
 */
export type PiTrust = 'inherit' | 'always' | 'never'

/**
 * Harness-specific adapter config. Authentication is never stored here: the
 * adapter runs the user's installed Pi, which reads its own `auth.json`,
 * environment, and model configuration.
 */
export type PiConfig = {
  /** Absolute path to the Pi binary. Resolved at install time. */
  piPath?: string
  /** Pi agent directory. Defaults to PI_CODING_AGENT_DIR or ~/.pi/agent. */
  agentDir?: string
  /** Pi session root. Defaults to the agent dir's settings or <agentDir>/sessions. */
  sessionDir?: string
  /** Default model for new sessions, in Pi's `provider/id` form. */
  model?: string
  thinkingLevel?: PiThinkingLevel
  trust?: PiTrust
  /** Minutes an idle Pi process is kept alive. Defaults to 15. */
  idleTimeoutMinutes?: number
  /** Maximum live Pi processes. Idle processes are evicted first. Defaults to 3. */
  maxProcesses?: number
  /** Seconds a per-directory catalog process result is reused. Defaults to 30. */
  catalogCacheSeconds?: number
}

export type AdapterConfig = GenericAdapterConfig<{ pi: PiConfig }>

export function piPaths(env: NodeJS.ProcessEnv = process.env) {
  return adapterPaths('pi', env)
}

export function adapterConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  return piPaths(env).configPath
}

export function adapterIdentityPath(env: NodeJS.ProcessEnv = process.env): string {
  return piPaths(env).identityPath
}

export function adapterStatePath(env: NodeJS.ProcessEnv = process.env): string {
  return piPaths(env).statePath
}

export function adapterLogPath(env: NodeJS.ProcessEnv = process.env): string {
  return piPaths(env).logPath
}

export function adapterPidPath(env: NodeJS.ProcessEnv = process.env): string {
  return piPaths(env).pidPath
}

export function adapterDataDir(env: NodeJS.ProcessEnv = process.env): string {
  return piPaths(env).dataDir
}

export function loadIdentity(env: NodeJS.ProcessEnv = process.env): AdapterIdentity {
  return loadAdapterIdentity(piPaths(env).identityPath)
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): AdapterConfig | undefined {
  return readAdapterConfig<{ pi: PiConfig }>(piPaths(env))
}

export function writeConfig(config: AdapterConfig, env: NodeJS.ProcessEnv = process.env): void {
  writeAdapterConfig(piPaths(env), config)
}

export function removeConfig(env: NodeJS.ProcessEnv = process.env): void {
  removeAdapterConfig(piPaths(env))
}

export function removeIdentity(env: NodeJS.ProcessEnv = process.env): void {
  removeAdapterIdentity(piPaths(env))
}

/** The agent directory Pi itself would use. */
export function resolveAgentDir(config: PiConfig, env: NodeJS.ProcessEnv = process.env): string {
  return (
    config.agentDir?.trim() || env.PI_CODING_AGENT_DIR?.trim() || join(homedir(), '.pi', 'agent')
  )
}

/**
 * The global session root. Mirrors Pi's precedence: `--session-dir`, the
 * environment, the `sessionDir` setting, then `<agentDir>/sessions`.
 */
export function resolveSessionDir(config: PiConfig, env: NodeJS.ProcessEnv = process.env): string {
  return configuredSessionDir(config, env) ?? join(resolveAgentDir(config, env), 'sessions')
}

/** A custom session directory stores every working directory side by side. */
export function configuredSessionDir(
  config: PiConfig,
  env: NodeJS.ProcessEnv = process.env
): string | undefined {
  if (config.sessionDir?.trim()) return expandHome(config.sessionDir.trim())
  if (env.PI_CODING_AGENT_SESSION_DIR?.trim()) {
    return expandHome(env.PI_CODING_AGENT_SESSION_DIR.trim())
  }
  return sessionDirFromSettings(resolveAgentDir(config, env), undefined)
}

/** Where Pi stores a session for one working directory. */
export function sessionDirFor(
  config: PiConfig,
  cwd: string,
  env: NodeJS.ProcessEnv = process.env
): string {
  const custom = projectSessionDir(cwd) ?? configuredSessionDir(config, env)
  if (custom) return custom
  return join(resolveAgentDir(config, env), 'sessions', encodeDirectory(cwd))
}

export function encodeDirectory(cwd: string): string {
  return `--${cwd.replace(/^[/\\]/, '').replace(/[/\\:]/g, '-')}--`
}

/**
 * A project can point Pi at another session directory. Pi reads that setting
 * before resolving project trust, so the adapter does the same when it lists
 * that directory.
 */
export function projectSessionDir(directory: string): string | undefined {
  const settings = readSettings(join(directory, '.pi', 'settings.json'))
  if (!settings?.sessionDir) return undefined
  return expandHome(settings.sessionDir, directory)
}

/** Every session root that can hold sessions for the requested directory. */
export function sessionRoots(config: PiConfig, directory?: string): string[] {
  const roots = new Set<string>()
  roots.add(resolveSessionDir(config))
  if (directory) {
    const project = projectSessionDir(directory)
    if (project) roots.add(project)
  }
  return [...roots]
}

function sessionDirFromSettings(
  agentDir: string,
  directory: string | undefined
): string | undefined {
  const settings = readSettings(join(agentDir, 'settings.json'))
  if (!settings?.sessionDir) return undefined
  return expandHome(settings.sessionDir, directory)
}

function readSettings(path: string): { sessionDir?: string } | undefined {
  try {
    if (!existsSync(path)) return undefined
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
    if (!parsed || typeof parsed !== 'object') return undefined
    const value = (parsed as { sessionDir?: unknown }).sessionDir
    return typeof value === 'string' ? { sessionDir: value } : {}
  } catch {
    return undefined
  }
}

function expandHome(value: string, base?: string): string {
  const expanded = value.startsWith('~/') ? join(homedir(), value.slice(2)) : value
  if (isAbsolute(expanded)) return expanded
  return resolve(base ?? homedir(), expanded)
}
