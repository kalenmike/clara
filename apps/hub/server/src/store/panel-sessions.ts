import type { ClaraDatabase } from './database.ts'

/**
 * A panel sign-in. Only the token hash is stored; a database copy therefore
 * cannot be replayed as a session. `sessionVersion` ties the row to the user's
 * credential generation, so a password change or host reset invalidates it
 * without touching the table.
 */
export type PanelSessionRecord = {
  tokenHash: string
  userId: string
  sessionVersion: number
  remember: boolean
  createdAt: number
  lastSeen: number
  idleExpiresAt: number
  absoluteExpiresAt: number
}

/** The persistence boundary `PanelAuth` needs; SQLite in production, memory in tests. */
export type PanelSessionStore = {
  create(record: PanelSessionRecord): void
  find(tokenHash: string): PanelSessionRecord | undefined
  touch(tokenHash: string, lastSeen: number, idleExpiresAt: number): void
  delete(tokenHash: string): void
  deleteForUser(userId: string): void
  /** Drop expired rows, then the oldest beyond `max`. */
  prune(now: number, max: number): void
}

type SessionRow = {
  token_hash: string
  user_id: string
  session_version: number
  remember: number
  created_at: number
  last_seen: number
  idle_expires_at: number
  absolute_expires_at: number
}

export class SqlitePanelSessionStore implements PanelSessionStore {
  private readonly db: ClaraDatabase

  constructor(db: ClaraDatabase) {
    this.db = db
  }

  create(record: PanelSessionRecord): void {
    this.db
      .prepare(
        `INSERT INTO panel_sessions
           (token_hash, user_id, session_version, remember, created_at, last_seen,
            idle_expires_at, absolute_expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        record.tokenHash,
        record.userId,
        record.sessionVersion,
        record.remember ? 1 : 0,
        record.createdAt,
        record.lastSeen,
        record.idleExpiresAt,
        record.absoluteExpiresAt
      )
  }

  find(tokenHash: string): PanelSessionRecord | undefined {
    const row = this.db
      .prepare('SELECT * FROM panel_sessions WHERE token_hash = ?')
      .get(tokenHash) as SessionRow | undefined
    return row ? toRecord(row) : undefined
  }

  touch(tokenHash: string, lastSeen: number, idleExpiresAt: number): void {
    this.db
      .prepare('UPDATE panel_sessions SET last_seen = ?, idle_expires_at = ? WHERE token_hash = ?')
      .run(lastSeen, idleExpiresAt, tokenHash)
  }

  delete(tokenHash: string): void {
    this.db.prepare('DELETE FROM panel_sessions WHERE token_hash = ?').run(tokenHash)
  }

  deleteForUser(userId: string): void {
    this.db.prepare('DELETE FROM panel_sessions WHERE user_id = ?').run(userId)
  }

  prune(now: number, max: number): void {
    const write = this.db.transaction(() => {
      this.db
        .prepare(
          'DELETE FROM panel_sessions WHERE idle_expires_at <= ? OR absolute_expires_at <= ?'
        )
        .run(now, now)
      this.db
        .prepare(
          `DELETE FROM panel_sessions
            WHERE token_hash NOT IN (
              SELECT token_hash FROM panel_sessions ORDER BY last_seen DESC LIMIT ?
            )`
        )
        .run(max)
    })
    write()
  }
}

/** The default for tests and host-only paths; sessions live until the process ends. */
export class MemoryPanelSessionStore implements PanelSessionStore {
  private readonly sessions = new Map<string, PanelSessionRecord>()

  create(record: PanelSessionRecord): void {
    this.sessions.set(record.tokenHash, { ...record })
  }

  find(tokenHash: string): PanelSessionRecord | undefined {
    const record = this.sessions.get(tokenHash)
    return record ? { ...record } : undefined
  }

  touch(tokenHash: string, lastSeen: number, idleExpiresAt: number): void {
    const record = this.sessions.get(tokenHash)
    if (!record) return
    record.lastSeen = lastSeen
    record.idleExpiresAt = idleExpiresAt
  }

  delete(tokenHash: string): void {
    this.sessions.delete(tokenHash)
  }

  deleteForUser(userId: string): void {
    for (const [hash, record] of this.sessions) {
      if (record.userId === userId) this.sessions.delete(hash)
    }
  }

  prune(now: number, max: number): void {
    for (const [hash, record] of this.sessions) {
      if (now >= record.idleExpiresAt || now >= record.absoluteExpiresAt) {
        this.sessions.delete(hash)
      }
    }
    while (this.sessions.size > max) {
      const oldest = [...this.sessions.values()].sort(
        (left, right) => left.lastSeen - right.lastSeen
      )[0]
      if (!oldest) break
      this.sessions.delete(oldest.tokenHash)
    }
  }
}

function toRecord(row: SessionRow): PanelSessionRecord {
  return {
    tokenHash: row.token_hash,
    userId: row.user_id,
    sessionVersion: row.session_version,
    remember: row.remember === 1,
    createdAt: row.created_at,
    lastSeen: row.last_seen,
    idleExpiresAt: row.idle_expires_at,
    absoluteExpiresAt: row.absolute_expires_at,
  }
}
