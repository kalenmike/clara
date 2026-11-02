import { chmodSync, closeSync, existsSync, mkdirSync, openSync } from 'node:fs'
import { dirname } from 'node:path'
import { DEFAULT_SYNC_INTERVAL_MS } from '@clara/shared-types'
import Database from 'better-sqlite3'

export type ClaraDatabase = Database.Database

export const SCHEMA_VERSION = 7

const BUSY_TIMEOUT_MS = 5_000
const DATABASE_MODE = 0o600
const DIRECTORY_MODE = 0o700

type Migration = (db: ClaraDatabase) => void

/**
 * Migrations are append-only. `user_version` records how many have run, and
 * each one commits together with its version bump so a partial upgrade cannot
 * leave the database in an unknown shape.
 */
const MIGRATIONS: Migration[] = [
  (db) => {
    db.exec(`
      CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE client_storage (
        namespace TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT,
        updated_at INTEGER NOT NULL,
        updated_by TEXT,
        PRIMARY KEY (namespace, key)
      ) WITHOUT ROWID;

      CREATE TABLE client_storage_revisions (
        namespace TEXT PRIMARY KEY,
        revision INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      ) WITHOUT ROWID;
    `)

    const now = Date.now()
    const insert = db.prepare(
      'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT (key) DO NOTHING'
    )
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
      insert.run(key, JSON.stringify(value), now)
    }
  },
  /**
   * The shell policy arrived after the first release. Existing databases keep
   * their feature choices and start with command requests blocked.
   */
  (db) => {
    const now = Date.now()
    const insert = db.prepare(
      'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT (key) DO NOTHING'
    )
    insert.run('shell.mode', JSON.stringify('off'), now)
    insert.run('shell.commands', JSON.stringify([]), now)
  },
  /**
   * Traffic monitoring arrived after the first release. Existing agents keep
   * measuring so the panel does not start blind after an upgrade.
   */
  (db) => {
    const insert = db.prepare(
      'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT (key) DO NOTHING'
    )
    insert.run('monitoring.enabled', JSON.stringify(true), Date.now())
  },
  /**
   * Settings sync arrived after the first release. Existing agents start with
   * sync on and check every 30 seconds; the panel can change both.
   */
  (db) => {
    const insert = db.prepare(
      'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT (key) DO NOTHING'
    )
    const now = Date.now()
    insert.run('sync.enabled', JSON.stringify(true), now)
    insert.run('sync.intervalMs', JSON.stringify(DEFAULT_SYNC_INTERVAL_MS), now)
  },
  /**
   * Clara management arrived as an opt-in master switch. Existing agents keep
   * the old alert behavior until the panel turns it on.
   */
  (db) => {
    const insert = db.prepare(
      'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT (key) DO NOTHING'
    )
    insert.run('management.enabled', JSON.stringify(false), Date.now())
  },
  /**
   * Ledger alerts are delivered by the home agent. Its cursor and dedupe keys
   * live beside the agent settings, never in the plugin's ledger.
   */
  (db) => {
    db.exec(`
      CREATE TABLE ledger_alert_state (
        id     INTEGER PRIMARY KEY CHECK (id = 1),
        cursor INTEGER NOT NULL
      );

      CREATE TABLE ledger_alert_delivery (
        key          TEXT PRIMARY KEY,
        delivered_at INTEGER NOT NULL
      );
    `)
  },
  /**
   * Ledger alert delivery moved to a Clara-owned sidecar. Migrations are
   * append-only, so this removes the legacy tables from existing agent
   * databases (and from fresh ones created by the previous step).
   */
  (db) => {
    db.exec(`
      DROP TABLE IF EXISTS ledger_alert_state;
      DROP TABLE IF EXISTS ledger_alert_delivery;
    `)
  },
]

/** The settings seeded into every new database. */
export const DEFAULT_SETTINGS = {
  'features.opencode': true,
  'features.local': true,
  'features.relay': true,
  'features.push': true,
  'agent.stopped': false,
  'shell.mode': 'off',
  'shell.commands': [],
  'monitoring.enabled': true,
  'sync.enabled': true,
  'sync.intervalMs': DEFAULT_SYNC_INTERVAL_MS,
  'management.enabled': false,
} as const

export function openDatabase(path: string): ClaraDatabase {
  try {
    preparePath(path)
  } catch (cause) {
    throw new Error(`Could not prepare the Clara database at ${path}: ${errorMessage(cause)}`, {
      cause,
    })
  }

  let db: ClaraDatabase
  try {
    db = new Database(path)
  } catch (cause) {
    throw new Error(`Could not open the Clara database at ${path}: ${errorMessage(cause)}`, {
      cause,
    })
  }

  try {
    db.pragma('journal_mode = WAL')
    db.pragma('synchronous = NORMAL')
    db.pragma('foreign_keys = ON')
    db.pragma(`busy_timeout = ${BUSY_TIMEOUT_MS}`)
    migrate(db)
    secureFiles(path)
    return db
  } catch (cause) {
    try {
      db.close()
    } catch {
      // Keep the startup error about the original failure.
    }
    throw new Error(`Could not migrate the Clara database at ${path}: ${errorMessage(cause)}`, {
      cause,
    })
  }
}

export function closeDatabase(db: ClaraDatabase): void {
  try {
    db.pragma('wal_checkpoint(TRUNCATE)')
  } catch {
    // A read-only or already-closed database still needs to close cleanly.
  }
  db.close()
}

export function schemaVersion(db: ClaraDatabase): number {
  return db.pragma('user_version', { simple: true }) as number
}

function preparePath(path: string): void {
  mkdirSync(dirname(path), { recursive: true, mode: DIRECTORY_MODE })
  if (!existsSync(path)) {
    closeSync(openSync(path, 'a', DATABASE_MODE))
  }
  chmodSync(path, DATABASE_MODE)
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

function migrate(db: ClaraDatabase): void {
  const current = schemaVersion(db)
  if (!Number.isInteger(current) || current < 0 || current > MIGRATIONS.length) {
    throw new Error(
      `Database schema version ${current} is not supported (expected 0-${MIGRATIONS.length})`
    )
  }

  for (let version = current; version < MIGRATIONS.length; version += 1) {
    const migration = MIGRATIONS[version]
    if (!migration) continue
    const run = db.transaction(() => {
      migration(db)
      db.pragma(`user_version = ${version + 1}`)
    })
    run()
  }
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
