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

/**
 * Clara's config directory. The home agent keeps its settings database here;
 * the ledger gets its own file beside it.
 */
export function configDir(): string {
  const configured = process.env.CLARA_CONFIG_DIR?.trim()
  if (configured) return configured
  const xdg = process.env.XDG_CONFIG_HOME?.trim() || join(homedir(), '.config')
  return join(xdg, 'clara')
}

/** The live ledger. Distinct from the home agent's clara.db settings database. */
export const DEFAULT_DB_PATH = join(configDir(), 'ledger.db')

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
    }
    ran.push(file)
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
