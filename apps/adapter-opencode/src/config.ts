import {
  adapterPaths,
  loadIdentity as loadAdapterIdentity,
  readAdapterConfig,
  removeAdapterConfig,
  removeIdentity as removeAdapterIdentity,
  writeAdapterConfig,
} from '@clara/adapter'
import type { AdapterConfig as GenericAdapterConfig, AdapterIdentity } from '@clara/adapter'

export type OpenCodeConfig = {
  url: string
  username: string
  password?: string
}

export type AdapterConfig = GenericAdapterConfig<{ opencode: OpenCodeConfig }>

export function openCodePaths(env: NodeJS.ProcessEnv = process.env) {
  return adapterPaths('opencode', env)
}

export function adapterConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  return openCodePaths(env).configPath
}

export function adapterIdentityPath(env: NodeJS.ProcessEnv = process.env): string {
  return openCodePaths(env).identityPath
}

export function adapterStatePath(env: NodeJS.ProcessEnv = process.env): string {
  return openCodePaths(env).statePath
}

export function adapterLogPath(env: NodeJS.ProcessEnv = process.env): string {
  return openCodePaths(env).logPath
}

export function adapterPidPath(env: NodeJS.ProcessEnv = process.env): string {
  return openCodePaths(env).pidPath
}

export function loadIdentity(env: NodeJS.ProcessEnv = process.env): AdapterIdentity {
  return loadAdapterIdentity(openCodePaths(env).identityPath)
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): AdapterConfig | undefined {
  return readAdapterConfig<{ opencode: OpenCodeConfig }>(openCodePaths(env))
}

export function writeConfig(config: AdapterConfig, env: NodeJS.ProcessEnv = process.env): void {
  writeAdapterConfig(openCodePaths(env), config)
}

export function removeConfig(env: NodeJS.ProcessEnv = process.env): void {
  removeAdapterConfig(openCodePaths(env))
}

export function removeIdentity(env: NodeJS.ProcessEnv = process.env): void {
  removeAdapterIdentity(openCodePaths(env))
}
