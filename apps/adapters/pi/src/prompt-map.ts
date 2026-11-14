import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { PromptIdentity } from './pi/transcript.ts'

type Stored = {
  timestamp: number
  inboxID: string
  kind: 'user' | 'synthetic'
  description?: string
}

const MAX_RECORDS_PER_SESSION = 500

/**
 * Clara's optimistic prompt uses an inbox id; Pi writes the user message with
 * its own entry id. Persisting the message timestamp lets history reuse the
 * inbox id so the chat store deduplicates instead of showing two prompts.
 */
export class PromptMap {
  private readonly path: string
  private readonly data: Record<string, Stored[]>
  private dirty = false

  constructor(path: string) {
    this.path = path
    this.data = read(path)
  }

  remember(sessionID: string, identity: PromptIdentity, timestamp: number): void {
    const records = this.data[sessionID] ?? []
    if (records.some((record) => record.timestamp === timestamp)) return
    records.push({
      timestamp,
      inboxID: identity.id,
      kind: identity.kind,
      ...(identity.description ? { description: identity.description } : {}),
    })
    this.data[sessionID] = records.slice(-MAX_RECORDS_PER_SESSION)
    this.dirty = true
    this.flush()
  }

  identities(sessionID: string): Map<number, PromptIdentity> {
    const result = new Map<number, PromptIdentity>()
    for (const record of this.data[sessionID] ?? []) {
      result.set(record.timestamp, {
        id: record.inboxID,
        kind: record.kind,
        ...(record.description ? { description: record.description } : {}),
      })
    }
    return result
  }

  forget(sessionID: string): void {
    if (!(sessionID in this.data)) return
    delete this.data[sessionID]
    this.dirty = true
    this.flush()
  }

  flush(): void {
    if (!this.dirty) return
    this.dirty = false
    try {
      mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 })
      writeFileSync(this.path, `${JSON.stringify(this.data)}\n`, { mode: 0o600 })
    } catch {
      // The mapping is an optimization; a failed write must not fail a prompt.
    }
  }
}

function read(path: string): Record<string, Stored[]> {
  try {
    if (!existsSync(path)) return {}
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const result: Record<string, Stored[]> = {}
    for (const [session, value] of Object.entries(parsed)) {
      if (!Array.isArray(value)) continue
      const records: Stored[] = []
      for (const item of value) {
        if (!item || typeof item !== 'object') continue
        const record = item as Record<string, unknown>
        if (
          typeof record.timestamp !== 'number' ||
          typeof record.inboxID !== 'string' ||
          (record.kind !== 'user' && record.kind !== 'synthetic')
        ) {
          continue
        }
        records.push({
          timestamp: record.timestamp,
          inboxID: record.inboxID,
          kind: record.kind,
          ...(typeof record.description === 'string' ? { description: record.description } : {}),
        })
      }
      result[session] = records
    }
    return result
  } catch {
    return {}
  }
}
