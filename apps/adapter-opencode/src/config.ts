import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { bytesToBase64Url, generateKey, randomBytes } from '@clara/crypto'

export type AdapterConfig = {
  harnessId: string
  adapterId: string
  key: string
  wsUrl: string
  clientToken: string
  opencode: {
    url: string
    username: string
    password?: string
  }
  label?: string
}

function configDir(env = process.env): string {
  const configured = env.CLARA_ADAPTER_CONFIG_DIR?.trim()
  if (configured) return configured
  const xdg = env.XDG_CONFIG_HOME?.trim() || join(homedir(), '.config')
  return join(xdg, 'clara', 'adapters', 'opencode')
}

function dataDir(env = process.env): string {
  const configured = env.CLARA_ADAPTER_DATA_DIR?.trim()
  if (configured) return configured
  const xdg = env.XDG_DATA_HOME?.trim() || join(homedir(), '.local', 'share')
  return join(xdg, 'clara', 'adapters', 'opencode')
}

export function adapterConfigPath(env = process.env): string {
  return join(configDir(env), 'config.json')
}

export function adapterIdentityPath(env = process.env): string {
  return join(dataDir(env), 'identity.json')
}

export function adapterLogPath(env = process.env): string {
  return join(dataDir(env), 'adapter.log')
}

export function adapterPidPath(env = process.env): string {
  return join(dataDir(env), 'adapter.pid')
}

export function adapterStatePath(env = process.env): string {
  return join(dataDir(env), 'state.json')
}

export type AdapterIdentity = {
  harnessId: string
  adapterId: string
  key: string
}

export function loadIdentity(env = process.env): AdapterIdentity {
  const path = adapterIdentityPath(env)
  if (existsSync(path)) {
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<AdapterIdentity>
      if (
        typeof parsed.harnessId === 'string' &&
        typeof parsed.adapterId === 'string' &&
        typeof parsed.key === 'string'
      ) {
        return {
          harnessId: parsed.harnessId,
          adapterId: parsed.adapterId,
          key: parsed.key,
        }
      }
    } catch {
      // Fall through and create a new identity.
    }
  }
  const identity: AdapterIdentity = {
    harnessId: randomUUID(),
    adapterId: bytesToBase64Url(randomBytes(18)),
    key: generateKey(),
  }
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  writeFileSync(path, `${JSON.stringify(identity, null, 2)}\n`, { mode: 0o600 })
  chmodSync(path, 0o600)
  return identity
}

export function writeIdentity(identity: AdapterIdentity, env = process.env): void {
  const path = adapterIdentityPath(env)
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  writeFileSync(path, `${JSON.stringify(identity, null, 2)}\n`, { mode: 0o600 })
  chmodSync(path, 0o600)
}

export function readConfig(env = process.env): AdapterConfig | undefined {
  const path = adapterConfigPath(env)
  if (!existsSync(path)) return undefined
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as AdapterConfig
  } catch {
    return undefined
  }
}

export function writeConfig(config: AdapterConfig, env = process.env): void {
  const path = adapterConfigPath(env)
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 })
  chmodSync(path, 0o600)
}

export function removeConfig(): void {
  rmSync(adapterConfigPath(), { force: true })
}

export function removeIdentity(): void {
  rmSync(adapterIdentityPath(), { force: true })
}
