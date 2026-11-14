import type Database from 'better-sqlite3'

/** The subset of better-sqlite3 the hub and its stores use. */
export type SqliteDatabase = Database.Database
export type SqliteStatement = Database.Statement

export type SqliteOpenOptions = {
  readonly?: boolean
  fileMustExist?: boolean
}

/**
 * Open a SQLite database. Node resolves `./node.ts` (better-sqlite3); Bun
 * resolves `./bun.ts` through the `bun` export condition.
 */
export declare function openSqlite(path: string, options?: SqliteOpenOptions): SqliteDatabase
