import { chmodSync, closeSync, existsSync, mkdirSync, openSync } from 'node:fs'
import { dirname } from 'node:path'
import Database from 'better-sqlite3'

const BUSY_TIMEOUT_MS = 5_000
const DATABASE_MODE = 0o600
const DIRECTORY_MODE = 0o700

/**
 * Delivery state for ledger alerts. Kept in its own Clara-owned database so
 * the ledger stays read-only to the home agent and the agent database has no
 * Clara tables. One home agent writes this file; the ledger holds the alert
 * rows themselves.
 */
export class LedgerDeliveryStore {
  private readonly path: string
  private db: Database.Database | undefined

  constructor(path: string) {
    this.path = path
  }

  cursor(): number | undefined {
    const row = this.database()
      .prepare('SELECT cursor FROM delivery_state WHERE id = 1')
      .get() as { cursor?: number } | undefined
    return row?.cursor === undefined ? undefined : Number(row.cursor)
  }

  setCursor(cursor: number): void {
    this.database()
      .prepare(
        'INSERT INTO delivery_state (id, cursor) VALUES (1, ?) ' +
          'ON CONFLICT (id) DO UPDATE SET cursor = excluded.cursor'
      )
      .run(Math.max(0, Math.floor(cursor)))
  }

  delivered(key: string): boolean {
    return Boolean(
      this.database().prepare('SELECT 1 FROM delivered_alerts WHERE key = ?').get(key)
    )
  }

  markDelivered(key: string): void {
    this.database()
      .prepare(
        'INSERT INTO delivered_alerts (key, delivered_at) VALUES (?, ?) ' +
          'ON CONFLICT (key) DO UPDATE SET delivered_at = excluded.delivered_at'
      )
      .run(key, Date.now())
  }

  prune(days = 30): void {
    this.database()
      .prepare('DELETE FROM delivered_alerts WHERE delivered_at < ?')
      .run(Date.now() - days * 24 * 60 * 60 * 1000)
  }

  close(): void {
    this.db?.close()
    this.db = undefined
  }

  private database(): Database.Database {
    if (this.db) return this.db

    mkdirSync(dirname(this.path), { recursive: true, mode: DIRECTORY_MODE })
    if (!existsSync(this.path)) {
      closeSync(openSync(this.path, 'a', DATABASE_MODE))
    }

    const db = new Database(this.path)
    db.pragma(`busy_timeout = ${BUSY_TIMEOUT_MS}`)
    db.pragma('journal_mode = WAL')
    db.exec(`
      CREATE TABLE IF NOT EXISTS delivery_state (
        id     INTEGER PRIMARY KEY CHECK (id = 1),
        cursor INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS delivered_alerts (
        key          TEXT PRIMARY KEY,
        delivered_at INTEGER NOT NULL
      );
    `)
    secureFiles(this.path)
    this.db = db
    return db
  }
}

function secureFiles(path: string): void {
  for (const candidate of [path, `${path}-wal`, `${path}-shm`]) {
    try {
      if (existsSync(candidate)) chmodSync(candidate, DATABASE_MODE)
    } catch {
      // File permissions are best effort after the first chmod of the database.
    }
  }
}
