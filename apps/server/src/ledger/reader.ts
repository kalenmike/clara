import { existsSync } from 'node:fs'
import Database from 'better-sqlite3'
import type { LedgerAlert, LedgerAlertKind, LedgerInbox } from '@clara/shared-types'

export type LedgerAlertRow = {
  id: number
  alert: LedgerAlert
}

/**
 * Read-only view of the plugin's ledger database. The home agent is the alert
 * delivery service; it never writes the ledger.
 */
export class LedgerReader {
  private readonly path: string
  private readonly log?: (message: string, detail?: unknown) => void
  private missingTableLogged = false

  constructor(path: string, log?: (message: string, detail?: unknown) => void) {
    this.path = path
    this.log = log
  }

  inbox(limit = 100): LedgerInbox {
    const rows = this.query(
      `SELECT * FROM alerts
        WHERE resolved_at IS NULL
        ORDER BY created_at DESC, id DESC
        LIMIT ?`,
      [Math.max(1, Math.min(limit, 200))]
    )
    return {
      items: rows.map(toAlert),
      generatedAt: new Date().toISOString(),
    }
  }

  /** Rows newer than the cursor, including one-time events that are already resolved. */
  newAfter(cursor: number, limit = 100): LedgerAlertRow[] {
    const rows = this.query(
      `SELECT * FROM alerts
        WHERE id > ?
        ORDER BY id
        LIMIT ?`,
      [cursor, Math.max(1, Math.min(limit, 200))]
    )
    return rows.map((row) => ({ id: Number(row.id), alert: toAlert(row) }))
  }

  latestId(): number {
    const row = this.query('SELECT COALESCE(MAX(id), 0) AS id FROM alerts')[0]
    return Number(row?.id ?? 0)
  }

  private query(sql: string, parameters: unknown[] = []): Array<Record<string, unknown>> {
    if (!existsSync(this.path)) return []

    let db: Database.Database | undefined
    try {
      db = new Database(this.path, { readonly: true, fileMustExist: true })
      db.pragma('busy_timeout = 5000')
      return db.prepare(sql).all(...parameters) as Array<Record<string, unknown>>
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      if (!this.missingTableLogged && message.includes('no such table')) {
        this.missingTableLogged = true
        this.log?.('ledger alerts table is not available yet', message)
      }
      return []
    } finally {
      db?.close()
    }
  }
}

function toAlert(row: Record<string, unknown>): LedgerAlert {
  return {
    key: String(row.key),
    kind: String(row.kind) as LedgerAlertKind,
    featureId: Number(row.feature_id ?? 0),
    slug: String(row.slug ?? ''),
    workspace: String(row.workspace ?? ''),
    title: String(row.title ?? ''),
    body: String(row.body ?? ''),
    createdAt: String(row.created_at ?? ''),
  }
}
