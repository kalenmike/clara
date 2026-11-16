import { Buffer } from 'node:buffer'
import { Database } from 'bun:sqlite'
import type { SqliteDatabase, SqliteOpenOptions, SqliteStatement } from './types.ts'

type BunRow = Record<string, unknown>
type BunStatement = {
  all(...params: unknown[]): BunRow[]
  get(...params: unknown[]): BunRow | null
  run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint }
}

type BunDatabase = {
  prepare(sql: string): BunStatement
  exec(sql: string): void
  close(): void
  transaction<T extends (...args: never[]) => unknown>(fn: T): T
}

/**
 * bun:sqlite is close to better-sqlite3 but differs in three ways the hub
 * depends on: `get()` returns null, BLOBs are Uint8Array, and there is no
 * `pragma()`. Normalize those differences here so callers stay unchanged.
 */
export function openSqlite(path: string, options: SqliteOpenOptions = {}): SqliteDatabase {
  const databaseOptions = {
    ...(options.readonly ? { readonly: true } : {}),
    ...(options.fileMustExist ? { create: false } : {}),
  }
  // Bun 1.4 rejects an empty options object with SQLITE_MISUSE.
  const db = (
    Object.keys(databaseOptions).length > 0
      ? new Database(path, databaseOptions)
      : new Database(path)
  ) as unknown as BunDatabase
  return new BunSqliteDatabase(db) as unknown as SqliteDatabase
}

class BunSqliteDatabase {
  private readonly db: BunDatabase

  constructor(db: BunDatabase) {
    this.db = db
  }

  prepare(sql: string): SqliteStatement {
    return new BunSqliteStatement(this.db.prepare(sql)) as unknown as SqliteStatement
  }

  exec(sql: string): void {
    this.db.exec(sql)
  }

  pragma(source: string, options: { simple?: boolean } = {}): unknown {
    const rows = this.db.prepare(`PRAGMA ${source}`).all()
    if (options.simple) {
      const first = rows[0]
      return first ? Object.values(first)[0] : undefined
    }
    return rows
  }

  transaction<T extends (...args: never[]) => unknown>(fn: T): T {
    return this.db.transaction(fn)
  }

  close(): void {
    this.db.close()
  }
}

class BunSqliteStatement {
  private readonly statement: BunStatement

  constructor(statement: BunStatement) {
    this.statement = statement
  }

  all(...params: unknown[]): BunRow[] {
    return this.statement.all(...params).map(normalizeRow)
  }

  get(...params: unknown[]): BunRow | undefined {
    const row = this.statement.get(...params)
    return row == null ? undefined : normalizeRow(row)
  }

  run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint } {
    return this.statement.run(...params)
  }
}

/** better-sqlite3 returns Buffer for BLOBs; bun:sqlite returns Uint8Array. */
function normalizeRow(row: BunRow): BunRow {
  for (const [key, value] of Object.entries(row)) {
    if (value instanceof Uint8Array) row[key] = Buffer.from(value)
  }
  return row
}
