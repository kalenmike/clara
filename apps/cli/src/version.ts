import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * The packaged binary carries the release version at build time. A source
 * checkout falls back to the repository manifest so `clara version` is useful
 * before the binary exists.
 */
export function version(): string {
  const configured = process.env.CLARA_VERSION?.trim()
  if (configured) return configured
  return repositoryVersion() ?? '0.0.0'
}

export function commit(): string {
  return process.env.CLARA_COMMIT?.trim() || 'dev'
}

export function buildId(): string {
  return process.env.CLARA_BUILD_ID?.trim() || 'dev'
}

function repositoryVersion(): string | undefined {
  try {
    const here = dirname(fileURLToPath(import.meta.url))
    const manifest = JSON.parse(
      readFileSync(join(here, '..', '..', '..', 'package.json'), 'utf8')
    ) as {
      version?: unknown
    }
    return typeof manifest.version === 'string' ? manifest.version : undefined
  } catch {
    return undefined
  }
}
