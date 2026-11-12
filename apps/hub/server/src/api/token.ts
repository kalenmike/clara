import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { bytesToBase64Url, randomBytes } from '@clara/crypto'

export type ApiTokenSource = 'env' | 'file' | 'generated'

export type ApiTokenInfo = {
  token: string
  path?: string
  source: ApiTokenSource
}

/**
 * The bearer token for the loopback API. The browser never sees it; local tools
 * and the read-only MCP read it from the hub config directory.
 */
export function readApiToken(configDir: string): ApiTokenInfo {
  const envValue = process.env.CLARA_API_TOKEN?.trim()
  if (envValue) return { token: envValue, source: 'env' }

  const path = process.env.CLARA_API_TOKEN_FILE?.trim() || join(configDir, 'api.token')
  if (existsSync(path)) {
    try {
      chmodSync(path, 0o600)
    } catch {
      // Best effort on platforms without POSIX modes.
    }
    const token = readFileSync(path, 'utf8').trim()
    if (!token) throw new Error(`The API token file ${path} is empty`)
    return { token, path, source: 'file' }
  }

  const token = bytesToBase64Url(randomBytes(32))
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  writeFileSync(path, `${token}\n`, { mode: 0o600 })
  return { token, path, source: 'generated' }
}
