import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { openSecret, sealSecret, type SecretBox } from '@clara/crypto'
import type { SecretKeyInfo } from './secret-key.ts'

type SealedFile = {
  version: 1
  keyVersion: number
  box: SecretBox
}

/** Read a JSON value sealed with the hub secret key. */
export async function readSealed<T>(
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

/** Atomically write a JSON value sealed with the hub secret key. */
export async function writeSealed(
  path: string,
  secretKey: SecretKeyInfo,
  aad: string,
  value: unknown
): Promise<void> {
  const box = await sealSecret(secretKey.key, aad, JSON.stringify(value))
  writeJson(path, { version: 1, keyVersion: secretKey.version, box } satisfies SealedFile)
}

export function forgetSealed(path: string): void {
  rmSync(path, { force: true })
}

export function readJson<T>(
  path: string,
  validate: (value: unknown) => T | undefined
): T | undefined {
  try {
    if (!existsSync(path)) return undefined
    return validate(JSON.parse(readFileSync(path, 'utf8')) as unknown)
  } catch {
    return undefined
  }
}

export function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = `${path}.${process.pid}.tmp`
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  renameSync(temporary, path)
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
