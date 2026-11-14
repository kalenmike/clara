import { existsSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import type { ClaraFileSystemEntry } from '@clara/api-contract'

const SKIPPED = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.turbo',
  '.cache',
  '.venv',
  'venv',
  '__pycache__',
  'target',
  'vendor',
  '.gradle',
  '.idea',
])

const MAX_SCAN = 20_000
const MAX_RESULTS = 200
const MAX_WALK_MS = 1_500

/** Find files and directories for composer mentions. Read-only and bounded. */
export function findFiles(input: {
  directory: string
  query?: string
  type?: 'file' | 'directory'
  limit?: number
}): ClaraFileSystemEntry[] {
  if (!existsSync(input.directory)) return []
  const query = (input.query ?? '').trim().toLowerCase()
  const limit = Math.min(Math.max(input.limit ?? 50, 1), MAX_RESULTS)
  const started = Date.now()
  const results: ClaraFileSystemEntry[] = []
  let scanned = 0

  const walk = (directory: string) => {
    if (results.length >= limit || scanned >= MAX_SCAN || Date.now() - started > MAX_WALK_MS) {
      return
    }
    let entries
    try {
      entries = readdirSync(directory, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (results.length >= limit || scanned >= MAX_SCAN || Date.now() - started > MAX_WALK_MS) {
        return
      }
      if (entry.name.startsWith('.') && entry.name !== '.claude') continue
      const path = join(directory, entry.name)
      const type = entry.isDirectory() ? 'directory' : 'file'
      if (entry.isDirectory() && SKIPPED.has(entry.name)) continue
      scanned += 1
      const relativePath = relative(input.directory, path)
      const matches = query.length === 0 || relativePath.toLowerCase().includes(query)
      if (matches && (!input.type || input.type === type)) {
        results.push({ path, type })
      }
      if (entry.isDirectory()) walk(path)
    }
  }

  walk(input.directory)
  return results
}
