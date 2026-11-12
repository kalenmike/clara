import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { generateSecretKey, loadSecretKey } from '@clara/crypto'

export type SecretKeySource = 'env' | 'file' | 'generated'

export type SecretKeyInfo = {
  key: CryptoKey
  version: number
  source: SecretKeySource
  path?: string
}

/**
 * The key that encrypts harness credentials at rest. It is deliberately kept
 * outside the SQLite database so a copied database does not expose passwords.
 */
export async function readSecretKey(configDir: string): Promise<SecretKeyInfo> {
  const envValue = process.env.CLARA_SECRET_KEY?.trim()
  const envFile = process.env.CLARA_SECRET_KEY_FILE?.trim()
  if (envValue) return importValue(envValue, 'env')
  if (envFile) return importValue(readKeyFile(envFile), 'env')

  const path = join(configDir, 'secrets.key')
  if (existsSync(path)) {
    try {
      chmodSync(path, 0o600)
    } catch {
      // Best effort on platforms without POSIX modes.
    }
    return importValue(readKeyFile(path), 'file', path)
  }

  const value = generateSecretKey()
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  writeFileSync(path, `${value}\n`, { mode: 0o600 })
  return { key: await loadSecretKey(value), version: 1, source: 'generated', path }
}

async function importValue(
  value: string,
  source: SecretKeySource,
  path?: string
): Promise<SecretKeyInfo> {
  return { key: await loadSecretKey(value), version: 1, source, ...(path ? { path } : {}) }
}

function readKeyFile(path: string): string {
  let value: string
  try {
    value = readFileSync(path, 'utf8').trim()
  } catch (cause) {
    throw new Error(`Could not read ${path}: ${errorMessage(cause)}`, { cause })
  }
  if (!value) throw new Error(`The secret key file ${path} is empty`)
  return value
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
