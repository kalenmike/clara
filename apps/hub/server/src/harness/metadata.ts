import type { ClaraSession } from '@clara/api-contract'
import type { ClaraDatabase } from '../store/database.ts'
import type { ProjectStore } from '../projects/store.ts'

export type ClaraSessionState = {
  titleOverride?: string
  archivedAt?: number
  snoozedAt?: number
  viewedAt?: number
  metadata: NonNullable<ClaraSession['metadata']>
}

type SessionRow = {
  title_override: string | null
  archived_at: number | null
  snoozed_at: number | null
  viewed_at: number | null
  metadata_json: string
}

/**
 * Clara-owned session metadata. Projects and workspaces live in ProjectStore;
 * this store only remembers per-session overrides such as snooze, archive and
 * title.
 */
export class HarnessMetadataStore {
  private readonly db: ClaraDatabase
  private readonly projects: ProjectStore

  constructor(db: ClaraDatabase, projects: ProjectStore) {
    this.db = db
    this.projects = projects
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

  ensureSession(
    harnessId: string,
    sessionId: string,
    projectId: string,
    workspaceId?: string
  ): void {
    const now = Date.now()
    this.db
      .prepare(
        `INSERT INTO clara_sessions
           (harness_id, session_id, project_id, workspace_id, first_seen_at, last_seen_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(harness_id, session_id) DO UPDATE SET
           project_id = CASE
             WHEN clara_sessions.project_id = 'unknown' THEN excluded.project_id
             ELSE clara_sessions.project_id
           END,
           workspace_id = COALESCE(clara_sessions.workspace_id, excluded.workspace_id),
           last_seen_at = excluded.last_seen_at`
      )
      .run(harnessId, sessionId, projectId, workspaceId ?? null, now, now)
  }

  overlaySession(harnessId: string, session: ClaraSession): ClaraSession {
    const state = this.session(harnessId, session.id)
    const canonical = session.location?.directory
    let project =
      session.projectID && session.projectID !== 'global'
        ? this.projects.projectForHarnessProject(harnessId, session.projectID)
        : undefined
    let workspace =
      session.projectID && session.projectID !== 'global'
        ? this.projects.workspaceForHarnessProject(harnessId, session.projectID)
        : undefined
    if (!project && canonical && session.projectID && session.projectID !== 'global') {
      workspace = this.projects.linkMatchingWorkspace(harnessId, session.projectID, canonical)
      project = workspace
        ? this.projects.projectForHarnessProject(harnessId, session.projectID)
        : undefined
    }
    if (project) this.projects.touchActivity(project.id, session.time.updated)
    this.ensureSession(harnessId, session.id, project?.id ?? session.projectID, workspace?.id)
    const metadata: NonNullable<ClaraSession['metadata']> = {
      ...(session.metadata ?? {}),
      ...state.metadata,
    }
    if (state.snoozedAt !== undefined) metadata.snoozed = true
    else delete metadata.snoozed
    return {
      ...session,
      ...(project ? { projectID: project.id } : {}),
      ...(workspace ? { workspaceID: workspace.id } : {}),
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
