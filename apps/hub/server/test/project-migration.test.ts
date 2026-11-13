import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SCHEMA_VERSION, closeDatabase, openDatabase } from '../src/store/database.ts'

let dir: string
let path: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'clara-project-migration-'))
  path = join(dir, 'clara.db')
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('project workspace migration', () => {
  it('moves legacy project directories into workspaces and relinks sessions', () => {
    const legacy = new Database(path)
    legacy.pragma('foreign_keys = ON')
    legacy.exec(`
      CREATE TABLE harness_identities (
        harness_id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        first_seen_at INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL,
        retired_at INTEGER
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

      INSERT INTO harness_identities (harness_id, kind, first_seen_at, last_seen_at)
      VALUES ('harness-a', 'opencode', 1, 1);

      INSERT INTO clara_projects
        (id, canonical, name, created_at, updated_at)
      VALUES ('p_legacy', '/workspace/demo', 'Legacy', 10, 20);

      INSERT INTO harness_project_links
        (harness_id, harness_project_id, project_id, last_seen_at)
      VALUES
        ('harness-a', 'hp1', 'p_legacy', 30),
        ('harness-a', 'hp2', 'p_legacy', 31);

      INSERT INTO clara_sessions
        (harness_id, session_id, project_id, first_seen_at, last_seen_at)
      VALUES ('harness-a', 's1', 'p_legacy', 40, 50);

      PRAGMA user_version = 10;
    `)
    legacy.close()

    const db = openDatabase(path)
    try {
      expect(db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION)
      const columns = db.prepare('PRAGMA table_info(clara_projects)').all() as Array<{
        name: string
      }>
      expect(columns.map((column) => column.name)).not.toContain('canonical')

      const project = db
        .prepare('SELECT id, name, default_workspace_id FROM clara_projects WHERE id = ?')
        .get('p_legacy') as {
        id: string
        name: string
        default_workspace_id: string
      }
      expect(project).toMatchObject({ id: 'p_legacy', name: 'Legacy' })

      const workspace = db
        .prepare(
          `SELECT id, project_id, harness_id, directory, canonical
             FROM clara_project_workspaces
            WHERE project_id = ?`
        )
        .get('p_legacy') as {
        id: string
        project_id: string
        harness_id: string
        directory: string
        canonical: string
      }
      expect(workspace).toMatchObject({
        project_id: 'p_legacy',
        harness_id: 'harness-a',
        directory: '/workspace/demo',
        canonical: '/workspace/demo',
      })
      expect(project.default_workspace_id).toBe(workspace.id)

      const links = db
        .prepare(
          'SELECT harness_project_id, workspace_id FROM harness_project_links ORDER BY harness_project_id'
        )
        .all() as Array<{ harness_project_id: string; workspace_id: string }>
      expect(links).toEqual([
        { harness_project_id: 'hp1', workspace_id: workspace.id },
        { harness_project_id: 'hp2', workspace_id: workspace.id },
      ])

      const session = db
        .prepare("SELECT workspace_id FROM clara_sessions WHERE session_id = 's1'")
        .get() as { workspace_id: string }
      expect(session.workspace_id).toBe(workspace.id)
    } finally {
      closeDatabase(db)
    }
  })

  it('clears a workspace canonical that does not contain its directory', () => {
    const db = openDatabase(path)
    db.prepare(
      `INSERT INTO harness_identities (harness_id, kind, first_seen_at, last_seen_at)
       VALUES ('harness-a', 'opencode', 1, 1)`
    ).run()
    db.prepare(
      `INSERT INTO clara_projects (id, name, created_at, updated_at)
       VALUES ('p_bad', 'Bad', 10, 20)`
    ).run()
    db.prepare(
      `INSERT INTO clara_project_workspaces
         (id, project_id, harness_id, directory, canonical, created_at, updated_at, last_seen_at)
       VALUES ('w_bad', 'p_bad', 'harness-a', '/workspace/clara', '/home/opencode', 10, 20, 30)`
    ).run()
    db.prepare(
      `INSERT INTO harness_project_links
         (harness_id, harness_project_id, project_id, workspace_id, last_seen_at)
       VALUES ('harness-a', 'hp_home', 'p_bad', 'w_bad', 30)`
    ).run()
    db.prepare(
      `INSERT INTO clara_sessions
         (harness_id, session_id, project_id, workspace_id, first_seen_at, last_seen_at)
       VALUES ('harness-a', 's1', 'p_bad', 'w_bad', 40, 50)`
    ).run()
    db.pragma('user_version = 11')
    closeDatabase(db)

    const repaired = openDatabase(path)
    try {
      expect(repaired.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION)
      const workspace = repaired
        .prepare(
          'SELECT canonical, snapshot_json, last_seen_at FROM clara_project_workspaces WHERE id = ?'
        )
        .get('w_bad') as {
        canonical: string | null
        snapshot_json: string | null
        last_seen_at: number | null
      }
      expect(workspace).toEqual({ canonical: null, snapshot_json: null, last_seen_at: null })

      const link = repaired
        .prepare("SELECT 1 FROM harness_project_links WHERE harness_project_id = 'hp_home'")
        .get()
      expect(link).toBeUndefined()

      const session = repaired
        .prepare("SELECT project_id, workspace_id FROM clara_sessions WHERE session_id = 's1'")
        .get() as { project_id: string; workspace_id: string | null }
      expect(session).toEqual({ project_id: 'unknown', workspace_id: null })
    } finally {
      closeDatabase(repaired)
    }
  })
})
