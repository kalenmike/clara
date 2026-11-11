import { chmodSync, closeSync, existsSync, mkdirSync, openSync } from 'node:fs'
import { dirname } from 'node:path'
import { DEFAULT_SYNC_INTERVAL_MS } from '@clara/shared-types'
import Database from 'better-sqlite3'

export type ClaraDatabase = Database.Database

export const SCHEMA_VERSION = 9

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
   * The panel starts the orchestration service on explicit action. Existing
   * databases start with the switch off.
   */
  (db) => {
    db.prepare(
      'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT (key) DO NOTHING'
    ).run('orchestration.enabled', JSON.stringify(false), Date.now())
  },
  /**
   * Harness connections and panel authentication arrived together. Harness
   * credentials are encrypted separately from the non-secret settings table;
   * the panel stores only password hashes, never a plaintext admin key.
   */
  (db) => {
    db.exec(`
      CREATE TABLE harness_connections (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        label TEXT NOT NULL,
        base_url TEXT NOT NULL,
        auth_type TEXT NOT NULL,
        username TEXT,
        options_json TEXT NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 0,
        last_test_at INTEGER,
        last_test_ok INTEGER,
        last_test_error TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE UNIQUE INDEX harness_connections_active
        ON harness_connections(is_active)
        WHERE is_active = 1;

      CREATE TABLE harness_secrets (
        connection_id TEXT NOT NULL REFERENCES harness_connections(id) ON DELETE CASCADE,
        field TEXT NOT NULL,
        ciphertext BLOB NOT NULL,
        nonce BLOB NOT NULL,
        key_version INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (connection_id, field)
      ) WITHOUT ROWID;

      CREATE TABLE panel_users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL,
        disabled INTEGER NOT NULL DEFAULT 0,
        session_version INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        last_login_at INTEGER
      );

      CREATE TABLE panel_setup_tokens (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT REFERENCES panel_users(id) ON DELETE CASCADE,
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );
    `)
  },
  /**
   * Per-device credentials. Device keys and unused enrollment tokens are
   * encrypted with the secret key outside the database, the same way harness
   * passwords are stored.
   */
  (db) => {
    db.exec(`
      CREATE TABLE devices (
        id TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        last_seen_at INTEGER,
        last_transport TEXT,
        last_device_class TEXT,
        revoked_at INTEGER
      );

      CREATE TABLE device_keys (
        device_id TEXT PRIMARY KEY REFERENCES devices(id) ON DELETE CASCADE,
        ciphertext BLOB NOT NULL,
        nonce BLOB NOT NULL,
        key_version INTEGER NOT NULL
      ) WITHOUT ROWID;

      CREATE TABLE pairing_tokens (
        id TEXT PRIMARY KEY,
        ciphertext BLOB NOT NULL,
        nonce BLOB NOT NULL,
        key_version INTEGER NOT NULL,
        fingerprint TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        used_at INTEGER,
        used_device_id TEXT
      );
    `)
  },
  /**
   * The enrolled label stays as pairing recorded it; the panel can set an
   * optional alias that only changes the displayed name.
   */
  (db) => {
    db.exec('ALTER TABLE devices ADD COLUMN alias TEXT')
  },
  /**
   * Harness adapters own the harness connection. Connections are keyed by a
   * stable adapter identity so uninstall/install and re-pairing keep sessions
   * and Clara metadata attached.
   */
  (db) => {
    db.exec(`
      CREATE TABLE harness_identities (
        harness_id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        first_seen_at INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL,
        retired_at INTEGER
      );

      CREATE TABLE adapter_credentials (
        adapter_id TEXT PRIMARY KEY,
        harness_id TEXT NOT NULL REFERENCES harness_identities(harness_id) ON DELETE CASCADE,
        key_ciphertext BLOB NOT NULL,
        key_nonce BLOB NOT NULL,
        key_version INTEGER NOT NULL,
        fingerprint TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        revoked_at INTEGER
      );

      CREATE TABLE harness_pairings (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        label TEXT NOT NULL,
        token_ciphertext BLOB NOT NULL,
        token_nonce BLOB NOT NULL,
        key_version INTEGER NOT NULL,
        fingerprint TEXT NOT NULL,
        replaces_connection_id TEXT,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        used_at INTEGER,
        used_harness_id TEXT
      );

      CREATE TABLE clara_projects (
        id TEXT PRIMARY KEY,
        canonical TEXT NOT NULL UNIQUE,
        name TEXT,
        icon_json TEXT,
        commands_json TEXT,
        startup_script TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE harness_project_links (
        harness_id TEXT NOT NULL REFERENCES harness_identities(harness_id) ON DELETE CASCADE,
        harness_project_id TEXT NOT NULL,
        project_id TEXT NOT NULL REFERENCES clara_projects(id) ON DELETE CASCADE,
        last_seen_at INTEGER NOT NULL,
        PRIMARY KEY (harness_id, harness_project_id)
      );

      CREATE TABLE clara_sessions (
        harness_id TEXT NOT NULL REFERENCES harness_identities(harness_id) ON DELETE CASCADE,
        session_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        title_override TEXT,
        archived_at INTEGER,
        snoozed_at INTEGER,
        viewed_at INTEGER,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        first_seen_at INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL,
        PRIMARY KEY (harness_id, session_id)
      );

      ALTER TABLE harness_connections ADD COLUMN harness_id TEXT;
      ALTER TABLE harness_connections ADD COLUMN credential_id TEXT;
      ALTER TABLE harness_connections ADD COLUMN transport TEXT;
      ALTER TABLE harness_connections ADD COLUMN adapter_version TEXT;
      ALTER TABLE harness_connections ADD COLUMN protocol_version INTEGER;
      ALTER TABLE harness_connections ADD COLUMN harness_version TEXT;
      ALTER TABLE harness_connections ADD COLUMN capabilities_json TEXT;
      ALTER TABLE harness_connections ADD COLUMN online INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE harness_connections ADD COLUMN last_seen_at INTEGER;

      CREATE UNIQUE INDEX harness_connections_identity
        ON harness_connections(harness_id)
        WHERE harness_id IS NOT NULL;
    `)

    const legacy = db
      .prepare('SELECT id, kind, label, created_at, updated_at FROM harness_connections')
      .all() as Array<{
      id: string
      kind: string
      label: string
      created_at: number
      updated_at: number
    }>
    const insertIdentity = db.prepare(
      `INSERT INTO harness_identities (harness_id, kind, first_seen_at, last_seen_at)
       VALUES (?, ?, ?, ?)`
    )
    const updateConnection = db.prepare(
      `UPDATE harness_connections SET harness_id = ?, transport = 'local' WHERE id = ?`
    )
    for (const row of legacy) {
      const harnessId = `legacy-${row.id}`
      insertIdentity.run(harnessId, row.kind, row.created_at, row.updated_at)
      updateConnection.run(harnessId, row.id)
    }
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
  'orchestration.enabled': false,
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
