// Clara — database layer.
//
// Opens the ledger and applies any pending migration. The driver is chosen at
// runtime because the plugin may be loaded by either the Bun-built OpenCode
// server or a plain Node process (self-tests): `node:sqlite` first, then
// `bun:sqlite`. Both expose the same synchronous prepare/run/get/all shape.

import { existsSync, mkdirSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export type Row = Record<string, any>

export interface Stmt {
  run(...args: any[]): { changes: number; lastInsertRowid: number }
  get(...args: any[]): Row | undefined
  all(...args: any[]): Row[]
}

export interface Db {
  exec(sql: string): void
  prepare(sql: string): Stmt
  close(): void
}

/** Directory containing this file (the plugin root). */
export const HERE = dirname(fileURLToPath(import.meta.url))
export const MIGRATIONS_DIR = resolve(HERE, 'migrations')

/** Clara's data directory: the ledger and the home agent settings database. */
export function dataDir(): string {
  const configured = process.env.CLARA_DATA_DIR?.trim()
  if (configured) return configured
  const xdg = process.env.XDG_DATA_HOME?.trim() || join(homedir(), '.local', 'share')
  return join(xdg, 'clara')
}

/** The live ledger. Distinct from the home agent's clara.db settings database. */
export const DEFAULT_DB_PATH = join(dataDir(), 'ledger.db')

/** The home agent's settings database, shared read-only as a control channel. */
export function serverDbPath(): string {
  return process.env.CLARA_DB_PATH?.trim() || join(dataDir(), 'clara.db')
}

/**
 * Read one setting from the home agent database without writing it. The
 * plugin uses this for the Clara management master switch, which the panel
 * owns. A missing database or settings table means management is off.
 */
export async function readServerSetting(key: string): Promise<unknown> {
  const path = serverDbPath()
  if (!existsSync(path)) return undefined

  const db = await open(path)
  try {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
      { value?: unknown } | undefined
    if (!row || typeof row.value !== 'string') return undefined
    try {
      return JSON.parse(row.value)
    } catch {
      return undefined
    }
  } catch {
    // A server database from an older schema has no settings table yet.
    return undefined
  } finally {
    db.close()
  }
}

/** The panel-owned master switch. Defaults to off when the home agent is absent. */
export async function managementEnabled(): Promise<boolean> {
  return (await readServerSetting('management.enabled')) === true
}

let cached: { path: string; db: Db } | undefined

async function open(path: string): Promise<Db> {
  try {
    const mod: any = await import('node:sqlite')
    return new mod.DatabaseSync(path) as Db
  } catch {
    // Not running under Node, or the experimental module is unavailable.
  }

  try {
    // Keep the specifier in a variable so TypeScript does not try to resolve
    // Bun's module from a Node toolchain.
    const specifier = 'bun:sqlite'
    const mod: any = await import(specifier)
    return new mod.Database(path) as Db
  } catch {
    // fall through
  }

  throw new Error('Clara: no SQLite driver available. Tried `node:sqlite` and `bun:sqlite`.')
}

/** Open (and migrate) the ledger. Cached per path. */
export async function getDb(
  path: string = process.env.CLARA_LEDGER_DB_PATH || DEFAULT_DB_PATH
): Promise<Db> {
  if (cached && cached.path === path) return cached.db

  mkdirSync(dirname(path), { recursive: true })
  const db = await open(path)

  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  // The daemon and a tool call can race for the write lock. Wait briefly
  // instead of failing the tick.
  db.exec('PRAGMA busy_timeout = 5000')

  await migrate(db)

  cached = { path, db }
  return db
}

/** Apply every migrations/*.sql that has not been recorded yet, in name order. */
export async function migrate(db: Db): Promise<string[]> {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `)

  const applied = new Set(
    db
      .prepare('SELECT version FROM schema_migrations')
      .all()
      .map((r) => String(r.version))
  )

  if (!existsSync(MIGRATIONS_DIR)) return []

  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort()
  const ran: string[] = []

  for (const file of files) {
    if (applied.has(file)) continue
    const sql = await readFile(resolve(MIGRATIONS_DIR, file), 'utf8')

    // SQLite ignores `PRAGMA foreign_keys` inside a transaction. A schema
    // rebuild has to drop and rename tables that other rows reference, so
    // disable the checks before BEGIN and verify the whole database after.
    db.exec('PRAGMA foreign_keys = OFF')
    db.exec('BEGIN')
    try {
      db.exec(sql)
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(
        file,
        new Date().toISOString()
      )
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw new Error(`Clara: migration ${file} failed: ${(error as Error).message}`, {
        cause: error,
      })
    } finally {
      db.exec('PRAGMA foreign_keys = ON')
    }
    ran.push(file)
  }

  if (ran.length) {
    const violations = db.prepare('PRAGMA foreign_key_check').all()
    if (violations.length) {
      throw new Error(
        `Clara: migrations left ${violations.length} foreign-key violation(s): ` +
          JSON.stringify(violations)
      )
    }
  }

  return ran
}

export const now = (): string => new Date().toISOString()

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 60)
    .replace(/^-|-$/g, '')
}

export function shortTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toISOString().slice(0, 16).replace('T', ' ')
}

export function ago(iso: string | null | undefined): string {
  if (!iso) return 'never'
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 0) return 'just now'
  const mins = Math.floor(ms / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}
