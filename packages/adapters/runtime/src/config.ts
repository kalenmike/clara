import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { bytesToBase64Url, generateKey, randomBytes } from '@clara/crypto'
import type { AdapterConfig, AdapterIdentity, AdapterPaths } from './types.ts'

/**
 * Shown when the stored relay grant is missing or the relay refused it. Grants
 * do not survive a reinstall of the hub and cannot be repaired locally, so the
 * only fix is a fresh pairing code.
 */
export const REINSTALL_GRANT_MESSAGE =
  'The adapter has no valid relay grant. Reinstall the adapter with a new pairing code.'

/**
 * Local mode is a bare `ws://` hub listener without the relay. It keeps the v4
 * session crypto but presents no grant, because the hub has no relay grant
 * issuer there.
 */
export function isLocalHubUrl(url: string): boolean {
  return url.trim().startsWith('ws://')
}

export function readJsonFile<T>(path: string): T | undefined {
  if (!existsSync(path)) return undefined
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T
  } catch {
    return undefined
  }
}

export function writeJsonFile(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  chmodSync(path, 0o600)
}

export function removeFile(path: string): void {
  rmSync(path, { force: true })
}

export function loadIdentity(path: string): AdapterIdentity {
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
  writeIdentity(path, identity)
  return identity
}

export function writeIdentity(path: string, identity: AdapterIdentity): void {
  writeJsonFile(path, identity)
}

export function readAdapterConfig<THarness>(
  paths: AdapterPaths
): AdapterConfig<THarness> | undefined {
  return readJsonFile<AdapterConfig<THarness>>(paths.configPath)
}

export function writeAdapterConfig<THarness>(
  paths: AdapterPaths,
  config: AdapterConfig<THarness>
): void {
  writeJsonFile(paths.configPath, config)
}

export function removeAdapterConfig(paths: AdapterPaths): void {
  removeFile(paths.configPath)
}

export function removeIdentity(paths: AdapterPaths): void {
  removeFile(paths.identityPath)
}
