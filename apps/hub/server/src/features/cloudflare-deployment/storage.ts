import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { openSecret, sealSecret, type SecretBox } from '@clara/crypto'
import type { RelayConfig } from '../../config.ts'
import type { SecretKeyInfo } from '../../store/secret-key.ts'

const CREDENTIALS_FILE = 'relay-credentials.json'
const DEPLOYMENT_FILE = 'relay-deployment.json'
const API_TOKEN_FILE = 'cloudflare-api-token.json'
const CREDENTIALS_AAD = 'clara:relay:credentials'
const API_TOKEN_AAD = 'clara:cloudflare:api-token'

type SealedFile = {
  version: 1
  keyVersion: number
  box: SecretBox
}

export type RelayDeploymentRecord = {
  accountId: string
  accountName?: string
  scriptName: string
  hostname: string
  deployedAt: string
  reachable: boolean
}

export function loadRelayCredentials(
  configDir: string,
  secretKey: SecretKeyInfo
): Promise<RelayConfig | undefined> {
  return readSealed<RelayConfig>(join(configDir, CREDENTIALS_FILE), secretKey, CREDENTIALS_AAD)
}

export async function saveRelayCredentials(
  configDir: string,
  secretKey: SecretKeyInfo,
  relay: RelayConfig
): Promise<void> {
  await writeSealed(join(configDir, CREDENTIALS_FILE), secretKey, CREDENTIALS_AAD, relay)
}

export function loadRelayDeployment(configDir: string): RelayDeploymentRecord | undefined {
  return readJson<RelayDeploymentRecord>(join(configDir, DEPLOYMENT_FILE), (value) => {
    if (!isRecord(value)) return undefined
    if (
      typeof value.accountId !== 'string' ||
      typeof value.scriptName !== 'string' ||
      typeof value.hostname !== 'string' ||
      typeof value.deployedAt !== 'string' ||
      typeof value.reachable !== 'boolean'
    ) {
      return undefined
    }
    return {
      accountId: value.accountId,
      scriptName: value.scriptName,
      hostname: value.hostname,
      deployedAt: value.deployedAt,
      reachable: value.reachable,
      ...(typeof value.accountName === 'string' ? { accountName: value.accountName } : {}),
    }
  })
}

export function saveRelayDeployment(configDir: string, record: RelayDeploymentRecord): void {
  writeJson(join(configDir, DEPLOYMENT_FILE), record)
}

export function forgetRelayDeployment(configDir: string): void {
  rmSync(join(configDir, DEPLOYMENT_FILE), { force: true })
}

export function loadCloudflareToken(
  configDir: string,
  secretKey: SecretKeyInfo
): Promise<string | undefined> {
  return readSealed<string>(join(configDir, API_TOKEN_FILE), secretKey, API_TOKEN_AAD)
}

export function saveCloudflareToken(
  configDir: string,
  secretKey: SecretKeyInfo,
  token: string
): Promise<void> {
  return writeSealed(join(configDir, API_TOKEN_FILE), secretKey, API_TOKEN_AAD, token)
}

export function forgetCloudflareToken(configDir: string): void {
  rmSync(join(configDir, API_TOKEN_FILE), { force: true })
}

export function hasCloudflareToken(configDir: string): boolean {
  return existsSync(join(configDir, API_TOKEN_FILE))
}

async function readSealed<T>(
  path: string,
  secretKey: SecretKeyInfo,
  aad: string
): Promise<T | undefined> {
  if (!existsSync(path)) return undefined
  const file = readJson<SealedFile>(path, (value) => {
    if (!isRecord(value) || value.version !== 1 || !isRecord(value.box)) return undefined
    if (typeof value.keyVersion !== 'number') return undefined
    if (typeof value.box.iv !== 'string' || typeof value.box.ct !== 'string') return undefined
    return value as SealedFile
  })
  if (!file) return undefined
  if (file.keyVersion !== secretKey.version) return undefined
  try {
    const plaintext = await openSecret(secretKey.key, aad, file.box)
    return JSON.parse(plaintext) as T
  } catch {
    return undefined
  }
}

async function writeSealed(
  path: string,
  secretKey: SecretKeyInfo,
  aad: string,
  value: unknown
): Promise<void> {
  const box = await sealSecret(secretKey.key, aad, JSON.stringify(value))
  writeJson(path, { version: 1, keyVersion: secretKey.version, box } satisfies SealedFile)
}

function readJson<T>(path: string, validate: (value: unknown) => T | undefined): T | undefined {
  try {
    if (!existsSync(path)) return undefined
    return validate(JSON.parse(readFileSync(path, 'utf8')) as unknown)
  } catch {
    return undefined
  }
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = `${path}.${process.pid}.tmp`
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  renameSync(temporary, path)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
