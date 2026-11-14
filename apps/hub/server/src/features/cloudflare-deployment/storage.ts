import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { SecretKeyInfo } from '../../store/secret-key.ts'
import {
  forgetSealed,
  isRecord,
  readJson,
  readSealed,
  writeJson,
  writeSealed,
} from '../../store/sealed.ts'

const DEPLOYMENT_FILE = 'relay-deployment.json'
const API_TOKEN_FILE = 'cloudflare-api-token.json'
const API_TOKEN_AAD = 'clara:cloudflare:api-token'

export type RelayDeploymentCustomDomain = {
  hostname: string
  zoneId: string
  domainId: string
  ready: boolean
}

export type RelayDeploymentRecord = {
  accountId: string
  accountName?: string
  scriptName: string
  hostname: string
  deployedAt: string
  reachable: boolean
  /** Preview/version URLs were requested for this Worker. Off by default. */
  previewUrls: boolean
  /** Attached Worker custom domain. Absent on older records. */
  customDomain?: RelayDeploymentCustomDomain
  /** The workers.dev host was turned off after a ready custom hostname. */
  disableWorkersDev?: boolean
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
    const customDomain = readCustomDomain(value.customDomain)
    return {
      accountId: value.accountId,
      scriptName: value.scriptName,
      hostname: value.hostname,
      deployedAt: value.deployedAt,
      reachable: value.reachable,
      previewUrls: value.previewUrls === true,
      ...(typeof value.accountName === 'string' ? { accountName: value.accountName } : {}),
      ...(customDomain ? { customDomain } : {}),
      ...(value.disableWorkersDev === true ? { disableWorkersDev: true } : {}),
    }
  })
}

function readCustomDomain(value: unknown): RelayDeploymentCustomDomain | undefined {
  if (
    !isRecord(value) ||
    typeof value.hostname !== 'string' ||
    typeof value.zoneId !== 'string' ||
    typeof value.domainId !== 'string' ||
    typeof value.ready !== 'boolean'
  ) {
    return undefined
  }
  return {
    hostname: value.hostname,
    zoneId: value.zoneId,
    domainId: value.domainId,
    ready: value.ready,
  }
}

export function saveRelayDeployment(configDir: string, record: RelayDeploymentRecord): void {
  writeJson(join(configDir, DEPLOYMENT_FILE), record)
}

export function forgetRelayDeployment(configDir: string): void {
  forgetSealed(join(configDir, DEPLOYMENT_FILE))
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
  forgetSealed(join(configDir, API_TOKEN_FILE))
}

export function hasCloudflareToken(configDir: string): boolean {
  return existsSync(join(configDir, API_TOKEN_FILE))
}
