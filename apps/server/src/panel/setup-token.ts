import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const SETUP_FILE = 'admin-setup.txt'

export function setupTokenPath(configDir: string): string {
  return join(configDir, SETUP_FILE)
}

export function readSetupTokenFromEnv(): string | undefined {
  const direct = process.env.CLARA_ADMIN_SETUP_TOKEN?.trim()
  if (direct) return direct
  const file = process.env.CLARA_ADMIN_SETUP_TOKEN_FILE?.trim()
  if (!file) return undefined
  try {
    const value = readFileSync(file, 'utf8').trim()
    return value || undefined
  } catch (cause) {
    throw new Error(`Could not read ${file}: ${errorMessage(cause)}`, { cause })
  }
}

export function writeSetupToken(configDir: string, token: string): string {
  const path = setupTokenPath(configDir)
  mkdirSync(configDir, { recursive: true, mode: 0o700 })
  writeFileSync(path, `${token}\n`, { mode: 0o600 })
  return path
}

export function readSetupToken(configDir: string): string | undefined {
  const path = setupTokenPath(configDir)
  if (!existsSync(path)) return undefined
  try {
    chmodSync(path, 0o600)
    const value = readFileSync(path, 'utf8').trim()
    return value || undefined
  } catch (cause) {
    throw new Error(`Could not read ${path}: ${errorMessage(cause)}`, { cause })
  }
}

export function removeSetupToken(configDir: string): void {
  try {
    rmSync(setupTokenPath(configDir), { force: true })
  } catch {
    // The file is already gone or the config directory is read-only.
  }
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
