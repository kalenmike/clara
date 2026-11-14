import Database from 'better-sqlite3'
import type { SqliteDatabase, SqliteOpenOptions } from './types.ts'

export function openSqlite(path: string, options?: SqliteOpenOptions): SqliteDatabase {
  return new Database(path, options)
}
