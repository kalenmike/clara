import type { ClaraTokenUsage } from '@clara/api-contract'
import { readJsonFile, writeJsonFile } from '@clara/adapter-runtime'

export type StoredSession = {
  id: string
  directory: string
  canonical: string
  title?: string
  agent?: string
  model?: { id: string; providerID: string; variant?: string }
  createdAt: number
  updatedAt: number
  cost: number
  tokens: ClaraTokenUsage
  /** True once a Claude turn has written a transcript for this session. */
  started: boolean
  archived?: boolean
  outcome?: 'succeeded' | 'failed' | 'interrupted'
  forkedFrom?: string
  lastError?: string
}

type CatalogState = {
  version: 1
  sessions: Record<string, StoredSession>
}

const EMPTY_TOKENS: ClaraTokenUsage = {
  input: 0,
  output: 0,
  reasoning: 0,
  cache: { read: 0, write: 0 },
}

export function emptyTokens(): ClaraTokenUsage {
  return { ...EMPTY_TOKENS, cache: { ...EMPTY_TOKENS.cache } }
}

/**
 * Adapter-owned session metadata. Claude keeps transcripts on disk but has no
 * record for a session Clara creates before its first prompt, and no Clara
 * usage/title overlay. The catalog is a small 0600 JSON file in the adapter
 * data directory.
 */
export class SessionStore {
  private state: CatalogState
  private readonly path: string

  constructor(path: string) {
    this.path = path
    const loaded = readJsonFile<CatalogState>(path)
    this.state = loaded?.version === 1 && loaded.sessions ? loaded : { version: 1, sessions: {} }
  }

  list(): StoredSession[] {
    return Object.values(this.state.sessions)
  }

  get(id: string): StoredSession | undefined {
    return this.state.sessions[id]
  }

  byDirectory(directory: string): StoredSession[] {
    return this.list().filter(
      (session) => session.canonical === directory || session.directory === directory
    )
  }

  put(session: StoredSession): StoredSession {
    this.state.sessions[session.id] = session
    this.save()
    return session
  }

  patch(id: string, patch: Partial<StoredSession>): StoredSession | undefined {
    const existing = this.state.sessions[id]
    if (!existing) return undefined
    const next = { ...existing, ...patch, updatedAt: patch.updatedAt ?? Date.now() }
    this.state.sessions[id] = next
    this.save()
    return next
  }

  delete(id: string): void {
    if (!this.state.sessions[id]) return
    delete this.state.sessions[id]
    this.save()
  }

  private save(): void {
    writeJsonFile(this.path, this.state)
  }
}

export function mergeTokens(a: ClaraTokenUsage, b: ClaraTokenUsage): ClaraTokenUsage {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    reasoning: a.reasoning + b.reasoning,
    cache: { read: a.cache.read + b.cache.read, write: a.cache.write + b.cache.write },
  }
}
