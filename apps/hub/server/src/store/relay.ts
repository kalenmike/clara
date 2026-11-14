import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { SecretKeyInfo } from './secret-key.ts'
import { forgetSealed, isRecord, readSealed, writeSealed } from './sealed.ts'

const CREDENTIALS_FILE = 'relay-credentials.json'
const CREDENTIALS_AAD = 'clara:relay:credentials'

/** The hub token that authenticates the relay's agent role. */
export type RelayCredentials = {
  agentToken?: string
}

type StoredRelayCredentials = {
  version: 2
  agentToken?: string
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
  if (!agentToken) {
    forgetRelayCredentials(configDir)
    return
  }
  const stored: StoredRelayCredentials = {
    version: 2,
    ...(agentToken ? { agentToken } : {}),
  }
  await writeSealed(relayCredentialsPath(configDir), secretKey, CREDENTIALS_AAD, stored)
}

export function forgetRelayCredentials(configDir: string): void {
  forgetSealed(relayCredentialsPath(configDir))
}

/**
 * Read both the versioned token-only payload and the legacy full relay record
 * written by earlier Cloudflare deployments. The retired shared client token
 * in an old record is ignored.
 */
function parseCredentials(value: unknown): RelayCredentials | undefined {
  if (!isRecord(value)) return undefined
  const agentToken = nonEmpty(value.agentToken)
  return agentToken ? { agentToken } : undefined
}

function nonEmpty(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}
