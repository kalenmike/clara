import { createHash } from 'node:crypto'
import type { ClaraProject, ClaraSession } from '@clara/api-contract'
import type { ClaraDatabase } from '../store/database.ts'

export type ClaraProjectState = {
  id: string
  canonical: string
  name?: string
  icon?: ClaraProject['icon']
  commands?: ClaraProject['commands']
  startupScript?: string
}

export type ClaraSessionState = {
  titleOverride?: string
  archivedAt?: number
  snoozedAt?: number
  viewedAt?: number
  metadata: NonNullable<ClaraSession['metadata']>
}

type ProjectRow = {
  id: string
  canonical: string
  name: string | null
  icon_json: string | null
  commands_json: string | null
  startup_script: string | null
}

type SessionRow = {
  title_override: string | null
  archived_at: number | null
  snoozed_at: number | null
  viewed_at: number | null
  metadata_json: string
}

export class HarnessMetadataStore {
  private readonly db: ClaraDatabase

  constructor(db: ClaraDatabase) {
    this.db = db
  }

  projectId(canonical: string): string {
    const digest = createHash('sha256').update(canonical).digest('base64url')
    return `p_${digest.slice(0, 22)}`
  }

  /** Ensure a canonical directory has a Clara project and link it to a harness project. */
  ensureProject(harnessId: string, harnessProjectId: string, canonical: string): ClaraProjectState {
    const projectId = this.projectId(canonical)
    const now = Date.now()
    this.db
      .prepare(
        `INSERT INTO clara_projects (id, canonical, created_at, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at`
      )
      .run(projectId, canonical, now, now)
    this.db
      .prepare(
        `INSERT INTO harness_project_links
           (harness_id, harness_project_id, project_id, last_seen_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(harness_id, harness_project_id) DO UPDATE SET
           project_id = excluded.project_id,
           last_seen_at = excluded.last_seen_at`
      )
      .run(harnessId, harnessProjectId, projectId, now)
    return this.project(projectId) as ClaraProjectState
  }

  project(projectId: string): ClaraProjectState | undefined {
    const row = this.db
      .prepare(
        'SELECT id, canonical, name, icon_json, commands_json, startup_script FROM clara_projects WHERE id = ?'
      )
      .get(projectId) as ProjectRow | undefined
    return row ? toProjectState(row) : undefined
  }

  projectForHarness(harnessId: string, harnessProjectId: string): ClaraProjectState | undefined {
    const row = this.db
      .prepare(
        `SELECT p.id, p.canonical, p.name, p.icon_json, p.commands_json, p.startup_script
           FROM harness_project_links l
           JOIN clara_projects p ON p.id = l.project_id
          WHERE l.harness_id = ? AND l.harness_project_id = ?`
      )
      .get(harnessId, harnessProjectId) as ProjectRow | undefined
    return row ? toProjectState(row) : undefined
  }

  updateProject(
    projectId: string,
    patch: { name?: string; icon?: unknown; commands?: unknown; startupScript?: string }
  ): ClaraProjectState | undefined {
    const current = this.project(projectId)
    if (!current) return undefined
    this.db
      .prepare(
        `UPDATE clara_projects
            SET name = ?, icon_json = ?, commands_json = ?, startup_script = ?, updated_at = ?
          WHERE id = ?`
      )
      .run(
        patch.name ?? current.name ?? null,
        patch.icon === undefined
          ? current.icon
            ? JSON.stringify(current.icon)
            : null
          : JSON.stringify(patch.icon),
        patch.commands === undefined
          ? current.commands
            ? JSON.stringify(current.commands)
            : null
          : JSON.stringify(patch.commands),
        patch.startupScript ?? current.startupScript ?? null,
        Date.now(),
        projectId
      )
    return this.project(projectId)
  }

  overlayProject(harnessId: string, project: ClaraProject): ClaraProject {
    const state =
      this.projectForHarness(harnessId, project.id) ??
      this.ensureProject(harnessId, project.id, project.canonical)
    return {
      ...project,
      id: state.id,
      canonical: state.canonical,
      ...(state.name ? { name: state.name } : {}),
      ...(state.icon ? { icon: state.icon } : {}),
      ...(state.commands ? { commands: state.commands } : {}),
    }
  }

  session(harnessId: string, sessionId: string): ClaraSessionState {
    const row = this.db
      .prepare(
        `SELECT title_override, archived_at, snoozed_at, viewed_at, metadata_json
           FROM clara_sessions WHERE harness_id = ? AND session_id = ?`
      )
      .get(harnessId, sessionId) as SessionRow | undefined
    if (!row) return { metadata: {} }
    return {
      ...(row.title_override ? { titleOverride: row.title_override } : {}),
      ...(row.archived_at !== null ? { archivedAt: row.archived_at } : {}),
      ...(row.snoozed_at !== null ? { snoozedAt: row.snoozed_at } : {}),
      ...(row.viewed_at !== null ? { viewedAt: row.viewed_at } : {}),
      metadata: parseObject(row.metadata_json) as NonNullable<ClaraSession['metadata']>,
    }
  }

  ensureSession(harnessId: string, sessionId: string, projectId: string): void {
    const now = Date.now()
    this.db
      .prepare(
        `INSERT INTO clara_sessions
           (harness_id, session_id, project_id, first_seen_at, last_seen_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(harness_id, session_id) DO UPDATE SET
           project_id = CASE
             WHEN clara_sessions.project_id = 'unknown' THEN excluded.project_id
             ELSE clara_sessions.project_id
           END,
           last_seen_at = excluded.last_seen_at`
      )
      .run(harnessId, sessionId, projectId, now, now)
  }

  overlaySession(harnessId: string, session: ClaraSession): ClaraSession {
    const state = this.session(harnessId, session.id)
    const canonical = session.location?.directory
    const project =
      canonical && session.projectID && session.projectID !== 'global'
        ? this.ensureProject(harnessId, session.projectID, canonical)
        : this.projectForHarness(harnessId, session.projectID)
    this.ensureSession(harnessId, session.id, project?.id ?? session.projectID)
    const metadata: NonNullable<ClaraSession['metadata']> = {
      ...(session.metadata ?? {}),
      ...state.metadata,
    }
    if (state.snoozedAt !== undefined) metadata.snoozed = true
    else delete metadata.snoozed
    return {
      ...session,
      ...(project ? { projectID: project.id } : {}),
      ...(state.titleOverride ? { title: state.titleOverride } : {}),
      ...(state.archivedAt !== undefined
        ? { time: { ...session.time, archived: state.archivedAt } }
        : {}),
      ...(state.viewedAt !== undefined
        ? { time: { ...session.time, viewed: state.viewedAt } }
        : {}),
      metadata,
    }
  }

  harnessProjectId(harnessId: string, projectId: string): string | undefined {
    const row = this.db
      .prepare(
        'SELECT harness_project_id FROM harness_project_links WHERE harness_id = ? AND project_id = ?'
      )
      .get(harnessId, projectId) as { harness_project_id: string } | undefined
    return row?.harness_project_id
  }

  setSnoozed(harnessId: string, sessionId: string, snoozed: boolean): void {
    this.db
      .prepare(
        `INSERT INTO clara_sessions
           (harness_id, session_id, project_id, snoozed_at, first_seen_at, last_seen_at)
         VALUES (?, ?, 'unknown', ?, ?, ?)
         ON CONFLICT(harness_id, session_id) DO UPDATE SET snoozed_at = excluded.snoozed_at`
      )
      .run(harnessId, sessionId, snoozed ? Date.now() : null, Date.now(), Date.now())
  }

  setArchived(harnessId: string, sessionId: string, archived: boolean): void {
    this.db
      .prepare(
        `INSERT INTO clara_sessions
           (harness_id, session_id, project_id, archived_at, first_seen_at, last_seen_at)
         VALUES (?, ?, 'unknown', ?, ?, ?)
         ON CONFLICT(harness_id, session_id) DO UPDATE SET archived_at = excluded.archived_at`
      )
      .run(harnessId, sessionId, archived ? Date.now() : null, Date.now(), Date.now())
  }

  setViewed(harnessId: string, sessionId: string): void {
    this.db
      .prepare(
        `INSERT INTO clara_sessions
           (harness_id, session_id, project_id, viewed_at, first_seen_at, last_seen_at)
         VALUES (?, ?, 'unknown', ?, ?, ?)
         ON CONFLICT(harness_id, session_id) DO UPDATE SET viewed_at = excluded.viewed_at`
      )
      .run(harnessId, sessionId, Date.now(), Date.now(), Date.now())
  }

  setTitle(harnessId: string, sessionId: string, title: string | undefined): void {
    this.db
      .prepare(
        `INSERT INTO clara_sessions
           (harness_id, session_id, project_id, title_override, first_seen_at, last_seen_at)
         VALUES (?, ?, 'unknown', ?, ?, ?)
         ON CONFLICT(harness_id, session_id) DO UPDATE SET title_override = excluded.title_override`
      )
      .run(harnessId, sessionId, title ?? null, Date.now(), Date.now())
  }

  forget(harnessId: string): void {
    this.db.prepare('DELETE FROM harness_identities WHERE harness_id = ?').run(harnessId)
  }
}

function toProjectState(row: ProjectRow): ClaraProjectState {
  return {
    id: row.id,
    canonical: row.canonical,
    ...(row.name ? { name: row.name } : {}),
    ...(row.icon_json ? { icon: parseObject(row.icon_json) as ClaraProject['icon'] } : {}),
    ...(row.commands_json
      ? { commands: parseObject(row.commands_json) as ClaraProject['commands'] }
      : {}),
    ...(row.startup_script ? { startupScript: row.startup_script } : {}),
  }
}

function parseObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}
