import { randomUUID } from 'node:crypto'
import { chmodSync, closeSync, existsSync, mkdirSync, openSync } from 'node:fs'
import { dirname } from 'node:path'
import { DEFAULT_SYNC_INTERVAL_MS } from '@clara/shared-types'
import { openSqlite, type SqliteDatabase } from '@clara/sqlite'

export type ClaraDatabase = SqliteDatabase

export const SCHEMA_VERSION = 13

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
  /**
   * Adapters are the only harness connection type. Remove the retired direct
   * connection columns and secrets table, and drop migrated direct connections
   * that can no longer be proxied.
   */
  (db) => {
    db.exec(`
      DELETE FROM harness_connections
        WHERE harness_id IS NULL OR harness_id LIKE 'legacy-%';

      DROP TABLE IF EXISTS harness_secrets;

      ALTER TABLE harness_connections DROP COLUMN base_url;
      ALTER TABLE harness_connections DROP COLUMN auth_type;
      ALTER TABLE harness_connections DROP COLUMN username;
      ALTER TABLE harness_connections DROP COLUMN options_json;

      ALTER TABLE harness_pairings DROP COLUMN replaces_connection_id;
    `)
  },
  /**
   * Clara projects are user-owned containers, not directories. A project can
   * group several harness workspaces, so the old canonical column moves to
   * clara_project_workspaces and every existing link gets a workspace.
   */
  (db) => {
    const projects = db
      .prepare(
        `SELECT id, canonical, name, icon_json, commands_json, startup_script,
                created_at, updated_at
           FROM clara_projects`
      )
      .all() as Array<{
      id: string
      canonical: string
      name: string | null
      icon_json: string | null
      commands_json: string | null
      startup_script: string | null
      created_at: number
      updated_at: number
    }>
    const links = db
      .prepare(
        `SELECT harness_id, harness_project_id, project_id, last_seen_at
           FROM harness_project_links`
      )
      .all() as Array<{
      harness_id: string
      harness_project_id: string
      project_id: string
      last_seen_at: number
    }>

    db.exec(`
      CREATE TABLE clara_projects_next (
        id TEXT PRIMARY KEY,
        name TEXT,
        icon_json TEXT,
        commands_json TEXT,
        startup_script TEXT,
        archived_at INTEGER,
        last_active_at INTEGER,
        default_workspace_id TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      DROP TABLE harness_project_links;
      DROP TABLE clara_projects;
      ALTER TABLE clara_projects_next RENAME TO clara_projects;

      CREATE TABLE clara_project_workspaces (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES clara_projects(id) ON DELETE CASCADE,
        harness_id TEXT NOT NULL REFERENCES harness_identities(harness_id) ON DELETE CASCADE,
        directory TEXT NOT NULL,
        canonical TEXT,
        label TEXT,
        snapshot_json TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        last_seen_at INTEGER
      );

      CREATE UNIQUE INDEX clara_project_workspaces_location
        ON clara_project_workspaces(harness_id, directory);

      CREATE INDEX clara_project_workspaces_project
        ON clara_project_workspaces(project_id);

      CREATE TABLE harness_project_links (
        harness_id TEXT NOT NULL REFERENCES harness_identities(harness_id) ON DELETE CASCADE,
        harness_project_id TEXT NOT NULL,
        project_id TEXT NOT NULL REFERENCES clara_projects(id) ON DELETE CASCADE,
        workspace_id TEXT REFERENCES clara_project_workspaces(id) ON DELETE CASCADE,
        last_seen_at INTEGER NOT NULL,
        PRIMARY KEY (harness_id, harness_project_id)
      );

      CREATE INDEX harness_project_links_project
        ON harness_project_links(project_id);

      CREATE INDEX harness_project_links_workspace
        ON harness_project_links(workspace_id);

      ALTER TABLE clara_sessions ADD COLUMN workspace_id TEXT
        REFERENCES clara_project_workspaces(id) ON DELETE SET NULL;

      CREATE INDEX clara_sessions_project
        ON clara_sessions(project_id);
    `)

    const insertProject = db.prepare(
      `INSERT INTO clara_projects
         (id, name, icon_json, commands_json, startup_script, archived_at,
          last_active_at, default_workspace_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, NULL, ?, NULL, ?, ?)`
    )
    const lastActive = db.prepare(
      'SELECT MAX(last_seen_at) AS value FROM clara_sessions WHERE project_id = ?'
    )
    const now = Date.now()
    for (const project of projects) {
      const active = lastActive.get(project.id) as { value: number | null }
      insertProject.run(
        project.id,
        project.name,
        project.icon_json,
        project.commands_json,
        project.startup_script,
        active.value ?? project.updated_at,
        project.created_at,
        project.updated_at
      )
    }

    const workspaceByLocation = new Map<string, string>()
    const insertWorkspace = db.prepare(
      `INSERT INTO clara_project_workspaces
         (id, project_id, harness_id, directory, canonical, created_at, updated_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    const setDefaultWorkspace = db.prepare(
      'UPDATE clara_projects SET default_workspace_id = ? WHERE id = ?'
    )
    for (const project of projects) {
      const harnesses = new Set(
        links.filter((link) => link.project_id === project.id).map((link) => link.harness_id)
      )
      for (const harnessId of harnesses) {
        const workspaceID = `w_${randomUUID()}`
        insertWorkspace.run(
          workspaceID,
          project.id,
          harnessId,
          project.canonical,
          project.canonical,
          project.created_at,
          project.updated_at,
          now
        )
        workspaceByLocation.set(`${project.id}\u0000${harnessId}`, workspaceID)
      }
      const first = [...harnesses][0]
      if (first) {
        setDefaultWorkspace.run(
          workspaceByLocation.get(`${project.id}\u0000${first}`) ?? null,
          project.id
        )
      }
    }

    const insertLink = db.prepare(
      `INSERT INTO harness_project_links
         (harness_id, harness_project_id, project_id, workspace_id, last_seen_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    for (const link of links) {
      insertLink.run(
        link.harness_id,
        link.harness_project_id,
        link.project_id,
        workspaceByLocation.get(`${link.project_id}\u0000${link.harness_id}`) ?? null,
        link.last_seen_at
      )
    }

    db.exec(`
      UPDATE clara_sessions
         SET workspace_id = (
           SELECT w.id
             FROM clara_project_workspaces w
            WHERE w.project_id = clara_sessions.project_id
              AND w.harness_id = clara_sessions.harness_id
            LIMIT 1
         )
       WHERE project_id <> 'unknown'
    `)
  },
  /**
   * A hub release resolved workspace locations with OpenCode's nested query
   * shape, so every workspace fell back to the harness default directory
   * (usually `/home/opencode`). Those canonicals and the links derived from
   * them are wrong and can point sessions at another Clara project. Drop only
   * the resolvable-but-impossible values so the next sync can rebuild them
   * from the workspace directory. A canonical outside the workspace directory
   * is legitimate (a repository root); one that does not contain the directory
   * at all is the corrupted case.
   */
  (db) => {
    const corrupted = `
      canonical IS NOT NULL
      AND rtrim(canonical, '/') <> ''
      AND canonical <> directory
      AND NOT (
        rtrim(canonical, '/') = ''
        OR substr(directory, 1, length(rtrim(canonical, '/')) + 1) = rtrim(canonical, '/') || '/'
      )
    `
    db.exec(`
      DELETE FROM harness_project_links
       WHERE workspace_id IN (
         SELECT id FROM clara_project_workspaces WHERE ${corrupted}
       );

      UPDATE clara_sessions
         SET project_id = 'unknown', workspace_id = NULL
       WHERE workspace_id IN (
         SELECT id FROM clara_project_workspaces WHERE ${corrupted}
       );

      UPDATE clara_project_workspaces
         SET canonical = NULL, snapshot_json = NULL, last_seen_at = NULL
       WHERE ${corrupted};
    `)
  },
  /**
   * Session-scoped API calls resolve the owning harness from the session
   * record. The primary key starts with harness_id, so add a lookup index for
   * the session-first path used by every /v1/sessions/:sessionID request.
   */
  (db) => {
    db.exec(`
      CREATE INDEX IF NOT EXISTS clara_sessions_session
        ON clara_sessions(session_id);
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
    db = openSqlite(path)
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
