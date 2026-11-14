import type { SqliteStatement } from '@clara/sqlite'
import type { SyncEntry, SyncPushAction, SyncSnapshot } from '@clara/shared-types'
import type { ClaraDatabase } from './database.ts'

export const DEFAULT_SYNC_NAMESPACE = 'default'
export const MAX_SYNC_ENTRIES_PER_PUSH = 100
export const MAX_SYNC_VALUE_BYTES = 64 * 1024
export const MAX_SYNC_LIVE_ENTRIES = 500
export const MAX_SYNC_NAMESPACE_BYTES = 1024 * 1024
export const MAX_SYNC_NAMESPACE_LENGTH = 64
export const MAX_SYNC_KEY_LENGTH = 128

const NAMESPACE_PATTERN = /^[a-z0-9_-]+$/

/**
 * Keys that carry credentials must never reach the plaintext sync table.
 */
const SECRET_KEY_PREFIXES = [] as const
const SECRET_KEY_TERMS = [
  'psk',
  'password',
  'passwd',
  'token',
  'secret',
  'credential',
  'authorization',
  'private-key',
  'pairing',
] as const

export type SyncErrorCode = 'invalid' | 'too_large' | 'conflict' | 'disabled' | 'storage'

export type SyncFailure = {
  ok: false
  code: SyncErrorCode
  message: string
  namespace?: string
  snapshot?: SyncSnapshot
}

export type SyncSuccess = { ok: true; snapshot: SyncSnapshot }

export type SyncResult = SyncSuccess | SyncFailure

export type SyncCheckSuccess = { ok: true; namespace: string; revision: number }

export type SyncCheckResult = SyncCheckSuccess | SyncFailure

export type ClientStorageStats = {
  namespaces: number
  entries: number
  liveEntries: number
  tombstones: number
  bytes: number
}

export class ClientStorageStore {
  private readonly db: ClaraDatabase
  private readonly selectEntries: SqliteStatement
  private readonly selectRevision: SqliteStatement
  private readonly upsertEntry: SqliteStatement
  private readonly upsertRevision: SqliteStatement
  private readonly selectAll: SqliteStatement

  constructor(db: ClaraDatabase) {
    this.db = db
    this.selectEntries = db.prepare(
      'SELECT key, value, updated_at FROM client_storage WHERE namespace = ? ORDER BY key'
    )
    this.selectRevision = db.prepare(
      'SELECT revision FROM client_storage_revisions WHERE namespace = ?'
    )
    this.upsertEntry = db.prepare(
      'INSERT INTO client_storage (namespace, key, value, updated_at, updated_by) ' +
        'VALUES (?, ?, ?, ?, ?) ON CONFLICT (namespace, key) DO UPDATE SET ' +
        'value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by'
    )
    this.upsertRevision = db.prepare(
      'INSERT INTO client_storage_revisions (namespace, revision, updated_at) VALUES (?, ?, ?) ' +
        'ON CONFLICT (namespace) DO UPDATE SET ' +
        'revision = excluded.revision, updated_at = excluded.updated_at'
    )
    this.selectAll = db.prepare('SELECT namespace, value FROM client_storage')
  }

  pull(namespaceValue: string | undefined): SyncResult {
    const namespace = normalizeNamespace(namespaceValue)
    if (!namespace.ok) return namespace
    try {
      return { ok: true, snapshot: this.snapshot(namespace.value) }
    } catch (cause) {
      return storageFailure(cause, namespace.value)
    }
  }

  /** Read only the revision so clients can skip a full pull when nothing changed. */
  check(namespaceValue: string | undefined): SyncCheckResult {
    const namespace = normalizeNamespace(namespaceValue)
    if (!namespace.ok) return namespace
    try {
      return { ok: true, namespace: namespace.value, revision: this.revision(namespace.value) }
    } catch (cause) {
      return storageFailure(cause, namespace.value)
    }
  }

  push(action: SyncPushAction, updatedBy?: string): SyncResult {
    const namespace = normalizeNamespace(action.namespace)
    if (!namespace.ok) return namespace

    const baseRevision = action.baseRevision
    if (
      baseRevision !== undefined &&
      (typeof baseRevision !== 'number' || !Number.isSafeInteger(baseRevision) || baseRevision < 0)
    ) {
      return invalidFailure(namespace.value, 'baseRevision must be a non-negative integer')
    }

    if (!Array.isArray(action.entries)) {
      return invalidFailure(namespace.value, 'entries must be an array')
    }
    if (action.entries.length > MAX_SYNC_ENTRIES_PER_PUSH) {
      return tooLargeFailure(
        namespace.value,
        `A sync push may contain at most ${MAX_SYNC_ENTRIES_PER_PUSH} entries`
      )
    }

    const seen = new Set<string>()
    const entries: Array<{ key: string; value: string | null }> = []
    for (const candidate of action.entries) {
      if (!isRecord(candidate)) {
        return invalidFailure(namespace.value, 'Each sync entry must be an object')
      }
      const key = candidate.key
      if (!isValidSyncKey(key)) {
        return invalidFailure(namespace.value, 'A sync entry key is invalid')
      }
      if (isSecretSyncKey(key)) {
        return invalidFailure(
          namespace.value,
          'Secret-bearing keys cannot be synced; clients must not send credentials'
        )
      }
      const value = candidate.value
      if (value !== null && typeof value !== 'string') {
        return invalidFailure(namespace.value, `The value for "${key}" must be a string or null`)
      }
      if (typeof value === 'string' && Buffer.byteLength(value, 'utf8') > MAX_SYNC_VALUE_BYTES) {
        return tooLargeFailure(
          namespace.value,
          `The value for "${key}" exceeds ${MAX_SYNC_VALUE_BYTES} bytes`
        )
      }
      if (seen.has(key)) {
        return invalidFailure(namespace.value, `The key "${key}" appears more than once`)
      }
      seen.add(key)
      entries.push({ key, value })
    }

    const now = Date.now()
    try {
      const run = this.db.transaction((): SyncResult => {
        const revision = this.revision(namespace.value)
        if (baseRevision !== undefined && baseRevision !== revision) {
          return {
            ok: false,
            code: 'conflict',
            message: `The namespace is at revision ${revision}`,
            namespace: namespace.value,
            snapshot: this.snapshot(namespace.value),
          }
        }

        const existing = this.values(namespace.value)
        for (const entry of entries) existing.set(entry.key, entry.value)
        const limit = checkNamespaceLimits(existing)
        if (!limit.ok) return tooLargeFailure(namespace.value, limit.message)

        for (const entry of entries) {
          this.upsertEntry.run(namespace.value, entry.key, entry.value, now, updatedBy ?? null)
        }
        this.upsertRevision.run(namespace.value, revision + 1, now)
        return { ok: true, snapshot: this.snapshot(namespace.value) }
      })
      return run()
    } catch (cause) {
      return storageFailure(cause, namespace.value)
    }
  }

  stats(): ClientStorageStats {
    const rows = this.selectAll.all() as Array<{ namespace: string; value: string | null }>
    const namespaces = new Set<string>()
    let liveEntries = 0
    let tombstones = 0
    let bytes = 0
    for (const row of rows) {
      namespaces.add(row.namespace)
      if (row.value === null) {
        tombstones += 1
        continue
      }
      liveEntries += 1
      bytes += Buffer.byteLength(row.value, 'utf8')
    }
    return {
      namespaces: namespaces.size,
      entries: rows.length,
      liveEntries,
      tombstones,
      bytes,
    }
  }

  private snapshot(namespace: string): SyncSnapshot {
    const rows = this.selectEntries.all(namespace) as Array<{
      key: string
      value: string | null
      updated_at: number
    }>
    const entries: SyncEntry[] = rows.map((row) => ({
      key: row.key,
      value: row.value,
      updatedAt: row.updated_at,
    }))
    return { namespace, revision: this.revision(namespace), entries }
  }

  private revision(namespace: string): number {
    const row = this.selectRevision.get(namespace) as { revision?: unknown } | undefined
    return typeof row?.revision === 'number' ? row.revision : 0
  }

  private values(namespace: string): Map<string, string | null> {
    const rows = this.selectEntries.all(namespace) as Array<{
      key: string
      value: string | null
    }>
    return new Map(rows.map((row) => [row.key, row.value]))
  }
}

export function normalizeNamespace(
  value: string | undefined
): { ok: true; value: string } | SyncFailure {
  const namespace = value ?? DEFAULT_SYNC_NAMESPACE
  if (typeof namespace !== 'string') {
    return invalidFailure(undefined, 'namespace must be a string')
  }
  if (
    namespace.length === 0 ||
    namespace.length > MAX_SYNC_NAMESPACE_LENGTH ||
    !NAMESPACE_PATTERN.test(namespace)
  ) {
    return invalidFailure(
      undefined,
      'namespace must be 1-64 lowercase letters, numbers, underscores, or dashes'
    )
  }
  return { ok: true, value: namespace }
}

export function isValidSyncKey(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_SYNC_KEY_LENGTH &&
    !hasControlCharacter(value)
  )
}

function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0
    if (code < 0x20 || code === 0x7f) return true
  }
  return false
}

export function isSecretSyncKey(key: string): boolean {
  const lower = key.toLowerCase()
  if (SECRET_KEY_PREFIXES.some((prefix) => lower.startsWith(prefix))) return true
  return SECRET_KEY_TERMS.some((term) => lower.includes(term))
}

function checkNamespaceLimits(
  values: Map<string, string | null>
): { ok: true } | { ok: false; message: string } {
  let live = 0
  let bytes = 0
  for (const value of values.values()) {
    if (value === null) continue
    live += 1
    bytes += Buffer.byteLength(value, 'utf8')
  }
  if (live > MAX_SYNC_LIVE_ENTRIES) {
    return {
      ok: false,
      message: `A namespace may hold at most ${MAX_SYNC_LIVE_ENTRIES} live entries`,
    }
  }
  if (bytes > MAX_SYNC_NAMESPACE_BYTES) {
    return {
      ok: false,
      message: `A namespace may hold at most ${MAX_SYNC_NAMESPACE_BYTES} bytes`,
    }
  }
  return { ok: true }
}

function invalidFailure(namespace: string | undefined, message: string): SyncFailure {
  return { ok: false, code: 'invalid', message, ...(namespace ? { namespace } : {}) }
}

function tooLargeFailure(namespace: string | undefined, message: string): SyncFailure {
  return { ok: false, code: 'too_large', message, ...(namespace ? { namespace } : {}) }
}

function storageFailure(cause: unknown, namespace?: string): SyncFailure {
  return {
    ok: false,
    code: 'storage',
    message: cause instanceof Error ? cause.message : String(cause),
    ...(namespace ? { namespace } : {}),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
