import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * The packaged binary carries its build version at build time. A source
 * checkout identifies the commit it runs from, matching the builds under
 * `tools/build`, so `clara version` and the services report the same string.
 */
export function version(): string {
  const configured = process.env.CLARA_VERSION?.trim()
  if (configured) return configured
  return devVersion(repositoryVersion() ?? '0.0.0', repositoryCommit())
}

export function devVersion(base: string, commit: string | undefined): string {
  return commit ? `${base}-dev+${commit}` : `${base}-dev`
}

export function commit(): string {
  return process.env.CLARA_COMMIT?.trim() || 'dev'
}

export function buildId(): string {
  return process.env.CLARA_BUILD_ID?.trim() || 'dev'
}

function repositoryVersion(): string | undefined {
  try {
    const manifest = JSON.parse(readFileSync(join(repositoryRoot(), 'package.json'), 'utf8')) as {
      version?: unknown
    }
    return typeof manifest.version === 'string' ? manifest.version : undefined
  } catch {
    return undefined
  }
}

let cachedCommit: { value: string | undefined } | undefined

function repositoryCommit(): string | undefined {
  cachedCommit ??= { value: readCommit() }
  return cachedCommit.value
}

function readCommit(): string | undefined {
  try {
    const commit = execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], {
      cwd: repositoryRoot(),
      encoding: 'utf8',
      timeout: 1_000,
    }).trim()
    return commit || undefined
  } catch {
    return undefined
  }
}

function repositoryRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
}
