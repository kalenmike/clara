import { existsSync, readdirSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import { readFile } from 'node:fs/promises'
import {
  parseSession,
  sessionSummary,
  type PiSessionSummary,
  type ParsedSession,
} from './format.ts'

const READ_CONCURRENCY = 8

type Cached = {
  size: number
  mtimeMs: number
  summary: PiSessionSummary
}

/**
 * A stat-first index over Pi's session store. Session files are append-only, so
 * a file only needs to be parsed again after its size or mtime changes.
 */
export class SessionIndex {
  private readonly roots: () => string[]
  private readonly cache = new Map<string, Cached>()

  constructor(roots: () => string[]) {
    this.roots = roots
  }

  /** Every session file under the configured roots, newest first. */
  async list(extraRoots: string[] = []): Promise<PiSessionSummary[]> {
    const paths = this.paths(extraRoots)
    const summaries = await mapWithConcurrency(paths, READ_CONCURRENCY, (path) =>
      this.load(path).catch(() => undefined)
    )
    return summaries
      .filter((summary): summary is PiSessionSummary => summary !== undefined)
      .sort((a, b) => b.updated - a.updated)
  }

  /** Find one session by full id, without reading every file when the name matches. */
  async resolve(
    id: string,
    extraRoots: string[] = []
  ): Promise<{ path: string; summary: PiSessionSummary } | undefined> {
    const cached = [...this.cache.values()].find(
      (entry) => entry.summary.id === id && existsSync(entry.summary.path)
    )
    if (cached) return { path: cached.summary.path, summary: cached.summary }
    const paths = this.paths(extraRoots)
    const direct = paths.find((path) => basenameMatches(path, id))
    if (direct) {
      const summary = await this.load(direct).catch(() => undefined)
      if (summary?.id === id) return { path: direct, summary }
    }
    for (const path of paths) {
      const summary = await this.load(path).catch(() => undefined)
      if (summary?.id === id) return { path, summary }
    }
    return undefined
  }

  /** Resolve a path from a known session id and its directory. */
  pathFor(id: string): string | undefined {
    return this.paths().find((path) => basenameMatches(path, id))
  }

  async read(path: string): Promise<ParsedSession> {
    return parseSession(await readFile(path, 'utf8'))
  }

  async summary(path: string): Promise<PiSessionSummary | undefined> {
    return this.load(path).catch(() => undefined)
  }

  forget(path: string): void {
    this.cache.delete(path)
  }

  clear(): void {
    this.cache.clear()
  }

  private async load(path: string): Promise<PiSessionSummary> {
    const stats = statSync(path)
    const cached = this.cache.get(path)
    if (cached && cached.size === stats.size && cached.mtimeMs === stats.mtimeMs) {
      return cached.summary
    }
    const session = parseSession(await readFile(path, 'utf8'))
    const summary = sessionSummary(path, session)
    this.cache.set(path, {
      size: stats.size,
      mtimeMs: stats.mtimeMs,
      summary,
    })
    return summary
  }

  private paths(extraRoots: string[] = []): string[] {
    const found = new Set<string>()
    for (const root of new Set([...this.roots(), ...extraRoots])) {
      if (!existsSync(root)) continue
      let entries
      try {
        entries = readdirSync(root, { withFileTypes: true })
      } catch {
        continue
      }
      for (const entry of entries) {
        const path = join(root, entry.name)
        if (entry.isFile() && entry.name.endsWith('.jsonl')) {
          found.add(path)
          continue
        }
        if (!entry.isDirectory()) continue
        let files
        try {
          files = readdirSync(path, { withFileTypes: true })
        } catch {
          continue
        }
        for (const file of files) {
          if (file.isFile() && file.name.endsWith('.jsonl')) found.add(join(path, file.name))
        }
      }
    }
    return [...found]
  }
}

function basenameMatches(path: string, id: string): boolean {
  const name = basename(path).replace(/\.jsonl$/, '')
  return name === id || name.endsWith(`_${id}`)
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  map: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = next++
      if (index >= items.length) return
      results[index] = await map(items[index]!)
    }
  })
  await Promise.all(workers)
  return results
}
