import type { ClaraDatabase } from '../../store/database.ts'

/** Delivery state for ledger alerts. Kept in clara.db, never in the ledger. */
export class LedgerAlertStore {
  private readonly db: ClaraDatabase

  constructor(db: ClaraDatabase) {
    this.db = db
  }

  cursor(): number | undefined {
    const row = this.db.prepare('SELECT cursor FROM ledger_alert_state WHERE id = 1').get() as
      { cursor?: number } | undefined
    return row?.cursor === undefined ? undefined : Number(row.cursor)
  }

  setCursor(cursor: number): void {
    this.db
      .prepare(
        'INSERT INTO ledger_alert_state (id, cursor) VALUES (1, ?) ' +
          'ON CONFLICT (id) DO UPDATE SET cursor = excluded.cursor'
      )
      .run(Math.max(0, Math.floor(cursor)))
  }

  delivered(key: string): boolean {
    return Boolean(this.db.prepare('SELECT 1 FROM ledger_alert_delivery WHERE key = ?').get(key))
  }

  markDelivered(key: string): void {
    this.db
      .prepare(
        'INSERT INTO ledger_alert_delivery (key, delivered_at) VALUES (?, ?) ' +
          'ON CONFLICT (key) DO UPDATE SET delivered_at = excluded.delivered_at'
      )
      .run(key, Date.now())
  }

  prune(days = 30): void {
    this.db
      .prepare('DELETE FROM ledger_alert_delivery WHERE delivered_at < ?')
      .run(Date.now() - days * 24 * 60 * 60 * 1000)
  }
}
