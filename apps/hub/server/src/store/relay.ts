import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { SecretKeyInfo } from './secret-key.ts'
import { forgetSealed, isRecord, readSealed, writeSealed } from './sealed.ts'

const CREDENTIALS_FILE = 'relay-credentials.json'
const CREDENTIALS_AAD = 'clara:relay:credentials'

/** Relay tokens live together because the hub needs both to connect. */
export type RelayCredentials = {
  agentToken?: string
  clientToken?: string
}

type StoredRelayCredentials = {
  version: 2
  agentToken?: string
  clientToken?: string
}

export function relayCredentialsPath(configDir: string): string {
  return join(configDir, CREDENTIALS_FILE)
}

export function hasRelayCredentials(configDir: string): boolean {
  return existsSync(relayCredentialsPath(configDir))
}

export async function loadRelayCredentials(
  configDir: string,
  secretKey: SecretKeyInfo
): Promise<RelayCredentials | undefined> {
  const stored = await readSealed<unknown>(
    relayCredentialsPath(configDir),
    secretKey,
    CREDENTIALS_AAD
  )
  return parseCredentials(stored)
}

export async function saveRelayCredentials(
  configDir: string,
  secretKey: SecretKeyInfo,
  credentials: RelayCredentials
): Promise<void> {
  const agentToken = nonEmpty(credentials.agentToken)
  const clientToken = nonEmpty(credentials.clientToken)
  if (!agentToken && !clientToken) {
    forgetRelayCredentials(configDir)
    return
  }
  const stored: StoredRelayCredentials = {
    version: 2,
    ...(agentToken ? { agentToken } : {}),
    ...(clientToken ? { clientToken } : {}),
  }
  await writeSealed(relayCredentialsPath(configDir), secretKey, CREDENTIALS_AAD, stored)
}

export function forgetRelayCredentials(configDir: string): void {
  forgetSealed(relayCredentialsPath(configDir))
}

/**
 * Read both the versioned token-only payload and the legacy full relay record
 * written by earlier Cloudflare deployments.
 */
function parseCredentials(value: unknown): RelayCredentials | undefined {
  if (!isRecord(value)) return undefined
  const agentToken = nonEmpty(value.agentToken)
  const clientToken = nonEmpty(value.clientToken)
  if (!agentToken && !clientToken) return undefined
  return {
    ...(agentToken ? { agentToken } : {}),
    ...(clientToken ? { clientToken } : {}),
  }
}

function nonEmpty(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}
