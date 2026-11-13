import {
  adapterPaths,
  loadIdentity as loadAdapterIdentity,
  readAdapterConfig,
  removeAdapterConfig,
  removeIdentity as removeAdapterIdentity,
  writeAdapterConfig,
} from '@clara/adapter-runtime'
import type { AdapterConfig as GenericAdapterConfig, AdapterIdentity } from '@clara/adapter-runtime'

export type ClaudePermissionMode =
  'default' | 'acceptEdits' | 'plan' | 'bypassPermissions' | 'dontAsk' | 'auto'

/**
 * Harness-specific adapter config. Authentication is never stored here: the
 * adapter uses the Claude Code login on the machine that runs the harness, or
 * the ANTHROPIC_API_KEY / CLAUDE_CODE_OAUTH_TOKEN in its environment.
 */
export type ClaudeConfig = {
  /** Optional system Claude Code binary. Omit to use the SDK's pinned binary. */
  claudePath?: string
  model?: string
  agent?: string
  permissionMode?: ClaudePermissionMode
  permissionPrompts?: 'host' | 'none'
  maxTurns?: number
  maxBudgetUsd?: number
  /** Concurrent active sessions. Defaults to 2. */
  concurrency?: number
  additionalDirectories?: string[]
  allowDangerouslySkipPermissions?: boolean
}

export type AdapterConfig = GenericAdapterConfig<{ claude: ClaudeConfig }>

export function claudePaths(env: NodeJS.ProcessEnv = process.env) {
  return adapterPaths('claude', env)
}

export function adapterConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  return claudePaths(env).configPath
}

export function adapterIdentityPath(env: NodeJS.ProcessEnv = process.env): string {
  return claudePaths(env).identityPath
}

export function adapterStatePath(env: NodeJS.ProcessEnv = process.env): string {
  return claudePaths(env).statePath
}

export function adapterLogPath(env: NodeJS.ProcessEnv = process.env): string {
  return claudePaths(env).logPath
}

export function adapterPidPath(env: NodeJS.ProcessEnv = process.env): string {
  return claudePaths(env).pidPath
}

export function loadIdentity(env: NodeJS.ProcessEnv = process.env): AdapterIdentity {
  return loadAdapterIdentity(claudePaths(env).identityPath)
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): AdapterConfig | undefined {
  return readAdapterConfig<{ claude: ClaudeConfig }>(claudePaths(env))
}

export function writeConfig(config: AdapterConfig, env: NodeJS.ProcessEnv = process.env): void {
  writeAdapterConfig(claudePaths(env), config)
}

export function removeConfig(env: NodeJS.ProcessEnv = process.env): void {
  removeAdapterConfig(claudePaths(env))
}

export function removeIdentity(env: NodeJS.ProcessEnv = process.env): void {
  removeAdapterIdentity(claudePaths(env))
}
