import { randomUUID } from 'node:crypto'
import type { ClaraProject } from '@clara/api-contract'
import type { ClaraDatabase } from '../store/database.ts'

export type HarnessProjectSnapshot = {
  id?: string
  canonical?: string
  name?: string
  vcs?: string
  icon?: ClaraProject['icon']
  sandboxes?: string[]
}

export type ProjectState = {
  id: string
  name?: string
  icon?: ClaraProject['icon']
  commands?: ClaraProject['commands']
  startupScript?: string
  archivedAt?: number
  defaultWorkspaceID?: string
  lastActiveAt?: number
  createdAt: number
  updatedAt: number
}

export type WorkspaceState = {
  id: string
  projectID: string
  harnessID: string
  directory: string
  canonical?: string
  label?: string
  snapshot?: HarnessProjectSnapshot
  createdAt: number
  updatedAt: number
  lastSeenAt?: number
}

type ProjectRow = {
  id: string
  name: string | null
  icon_json: string | null
  commands_json: string | null
  startup_script: string | null
  archived_at: number | null
  last_active_at: number | null
  default_workspace_id: string | null
  created_at: number
  updated_at: number
}

type WorkspaceRow = {
  id: string
  project_id: string
  harness_id: string
  directory: string
  canonical: string | null
  label: string | null
  snapshot_json: string | null
  created_at: number
  updated_at: number
  last_seen_at: number | null
}

type LinkRow = {
  harness_id: string
  harness_project_id: string
  project_id: string
  workspace_id: string | null
  last_seen_at: number
}

export type ProjectRecord = {
  project: ProjectState
  workspaces: WorkspaceState[]
}

export type AddWorkspaceInput = {
  harnessID: string
  directory: string
  canonical?: string
  label?: string
  snapshot?: HarnessProjectSnapshot
}

export type ReconcileWorkspaceLinksInput = {
  workspaceID: string
  harnessID: string
  projectID: string
  harnessProjectIDs: string[]
  canonical?: string
  snapshot?: HarnessProjectSnapshot
}

export type ReconcileWorkspaceLinksResult = {
  linked: number
  /** Harness records already owned by a different Clara project. */
  conflicts: string[]
}

const PROJECT_COLUMNS = `
  id, name, icon_json, commands_json, startup_script, archived_at,
  last_active_at, default_workspace_id, created_at, updated_at
`

const WORKSPACE_COLUMNS = `
  id, project_id, harness_id, directory, canonical, label, snapshot_json,
  created_at, updated_at, last_seen_at
`

/**
 * Clara-owned project containers and their per-harness workspaces. The harness
 * only owns project records; Clara decides which containers exist and which
 * directories belong to them.
 */
export class ProjectStore {
  private readonly db: ClaraDatabase

  constructor(db: ClaraDatabase) {
    this.db = db
  }

  list(options: { archived?: boolean } = {}): ProjectRecord[] {
    const archived = options.archived === true
    const rows = this.db
      .prepare(
        `SELECT ${PROJECT_COLUMNS}
           FROM clara_projects
          WHERE (archived_at IS NOT NULL) = ?
          ORDER BY COALESCE(last_active_at, updated_at) DESC, created_at DESC`
      )
      .all(archived ? 1 : 0) as ProjectRow[]
    return rows.map((row) => this.recordFromRow(row))
  }

  get(projectID: string): ProjectRecord | undefined {
    const row = this.db
      .prepare(`SELECT ${PROJECT_COLUMNS} FROM clara_projects WHERE id = ?`)
      .get(projectID) as ProjectRow | undefined
    return row ? this.recordFromRow(row) : undefined
  }

  findByName(name: string): ProjectState | undefined {
    const row = this.db
      .prepare(`SELECT ${PROJECT_COLUMNS} FROM clara_projects WHERE name = ? COLLATE NOCASE`)
      .get(name.trim()) as ProjectRow | undefined
    return row ? toProjectState(row) : undefined
  }

  create(input: {
    name?: string
    icon?: ClaraProject['icon']
    commands?: ClaraProject['commands']
    startupScript?: string
  }): ProjectState {
    const id = `p_${randomUUID()}`
    const now = Date.now()
    this.db
      .prepare(
        `INSERT INTO clara_projects
           (id, name, icon_json, commands_json, startup_script, archived_at,
            last_active_at, default_workspace_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, NULL, ?, NULL, ?, ?)`
      )
      .run(
        id,
        input.name?.trim() || null,
        input.icon === undefined ? null : JSON.stringify(input.icon),
        input.commands === undefined ? null : JSON.stringify(input.commands),
        input.startupScript ?? null,
        now,
        now,
        now
      )
    return this.get(id)?.project as ProjectState
  }

  update(
    projectID: string,
    patch: {
      name?: string
      icon?: ClaraProject['icon']
      commands?: ClaraProject['commands']
      startupScript?: string
      defaultWorkspaceID?: string | null
    }
  ): ProjectState | undefined {
    const record = this.get(projectID)
    if (!record) return undefined
    const project = record.project
    this.db
      .prepare(
        `UPDATE clara_projects
            SET name = ?, icon_json = ?, commands_json = ?, startup_script = ?,
                default_workspace_id = ?, updated_at = ?
          WHERE id = ?`
      )
      .run(
        patch.name === undefined ? (project.name ?? null) : patch.name.trim() || null,
        patch.icon === undefined
          ? project.icon
            ? JSON.stringify(project.icon)
            : null
          : JSON.stringify(patch.icon),
        patch.commands === undefined
          ? project.commands
            ? JSON.stringify(project.commands)
            : null
          : JSON.stringify(patch.commands),
        patch.startupScript === undefined
          ? (project.startupScript ?? null)
          : patch.startupScript.trim() || null,
        patch.defaultWorkspaceID === undefined
          ? (project.defaultWorkspaceID ?? null)
          : patch.defaultWorkspaceID,
        Date.now(),
        projectID
      )
    return this.get(projectID)?.project
  }

  setArchived(projectID: string, archived: boolean): ProjectState | undefined {
    const result = this.db
      .prepare(
        `UPDATE clara_projects
            SET archived_at = ?, updated_at = ?
          WHERE id = ?`
      )
      .run(archived ? Date.now() : null, Date.now(), projectID)
    if (result.changes === 0) return undefined
    return this.get(projectID)?.project
  }

  /** Remove the container and every local reference to it. */
  delete(projectID: string): boolean {
    const write = this.db.transaction(() => {
      this.db
        .prepare(
          `UPDATE clara_sessions
              SET project_id = 'unknown', workspace_id = NULL
            WHERE project_id = ?`
        )
        .run(projectID)
      return this.db.prepare('DELETE FROM clara_projects WHERE id = ?').run(projectID).changes > 0
    })
    return write()
  }

  workspaces(projectID: string): WorkspaceState[] {
    const rows = this.db
      .prepare(
        `SELECT ${WORKSPACE_COLUMNS}
           FROM clara_project_workspaces
          WHERE project_id = ?
          ORDER BY created_at ASC`
      )
      .all(projectID) as WorkspaceRow[]
    return rows.map(toWorkspaceState)
  }

  workspace(workspaceID: string): WorkspaceState | undefined {
    const row = this.db
      .prepare(`SELECT ${WORKSPACE_COLUMNS} FROM clara_project_workspaces WHERE id = ?`)
      .get(workspaceID) as WorkspaceRow | undefined
    return row ? toWorkspaceState(row) : undefined
  }

  findWorkspaceByCanonical(harnessID: string, canonical: string): WorkspaceState | undefined {
    const row = this.db
      .prepare(
        `SELECT ${WORKSPACE_COLUMNS}
           FROM clara_project_workspaces
          WHERE harness_id = ? AND (canonical = ? OR directory = ?)
          ORDER BY created_at ASC
          LIMIT 1`
      )
      .get(harnessID, canonical, canonical) as WorkspaceRow | undefined
    return row ? toWorkspaceState(row) : undefined
  }

  addWorkspace(projectID: string, input: AddWorkspaceInput): WorkspaceState {
    const directory = input.directory.trim()
    if (!directory) throw new Error('A workspace directory is required')
    const existing = this.db
      .prepare(
        `SELECT ${WORKSPACE_COLUMNS}
           FROM clara_project_workspaces
          WHERE harness_id = ? AND directory = ?`
      )
      .get(input.harnessID, directory) as WorkspaceRow | undefined
    if (existing && existing.project_id !== projectID) {
      throw new Error('That directory is already linked to another Clara project')
    }
    if (existing) {
      if (input.canonical || input.label || input.snapshot) {
        this.db
          .prepare(
            `UPDATE clara_project_workspaces
                SET canonical = COALESCE(?, canonical),
                    label = COALESCE(?, label),
                    snapshot_json = COALESCE(?, snapshot_json),
                    last_seen_at = ?,
                    updated_at = ?
              WHERE id = ?`
          )
          .run(
            input.canonical ?? null,
            input.label ?? null,
            input.snapshot ? JSON.stringify(input.snapshot) : null,
            Date.now(),
            Date.now(),
            existing.id
          )
      }
      return this.workspace(existing.id) as WorkspaceState
    }

    const id = `w_${randomUUID()}`
    const now = Date.now()
    this.db
      .prepare(
        `INSERT INTO clara_project_workspaces
           (id, project_id, harness_id, directory, canonical, label, snapshot_json,
            created_at, updated_at, last_seen_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        projectID,
        input.harnessID,
        directory,
        input.canonical ?? null,
        input.label ?? null,
        input.snapshot ? JSON.stringify(input.snapshot) : null,
        now,
        now,
        now
      )
    const project = this.get(projectID)?.project
    if (project && !project.defaultWorkspaceID) {
      this.db
        .prepare('UPDATE clara_projects SET default_workspace_id = ?, updated_at = ? WHERE id = ?')
        .run(id, now, projectID)
    }
    return this.workspace(id) as WorkspaceState
  }

  removeWorkspace(workspaceID: string): boolean {
    const workspace = this.workspace(workspaceID)
    if (!workspace) return false
    const write = this.db.transaction(() => {
      this.db
        .prepare('UPDATE clara_sessions SET workspace_id = NULL WHERE workspace_id = ?')
        .run(workspaceID)
      this.db.prepare('DELETE FROM clara_project_workspaces WHERE id = ?').run(workspaceID)
      const project = this.get(workspace.projectID)
      if (project?.project.defaultWorkspaceID === workspaceID) {
        const next = this.db
          .prepare(
            `SELECT id FROM clara_project_workspaces
              WHERE project_id = ?
              ORDER BY created_at ASC
              LIMIT 1`
          )
          .get(workspace.projectID) as { id: string } | undefined
        this.db
          .prepare(
            'UPDATE clara_projects SET default_workspace_id = ?, updated_at = ? WHERE id = ?'
          )
          .run(next?.id ?? null, Date.now(), workspace.projectID)
      }
      return true
    })
    return write()
  }

  updateWorkspace(
    workspaceID: string,
    patch: {
      directory?: string
      canonical?: string | null
      label?: string | null
      snapshot?: HarnessProjectSnapshot | null
    }
  ): WorkspaceState | undefined {
    const current = this.workspace(workspaceID)
    if (!current) return undefined
    this.db
      .prepare(
        `UPDATE clara_project_workspaces
            SET directory = ?, canonical = ?, label = ?, snapshot_json = ?,
                last_seen_at = ?, updated_at = ?
          WHERE id = ?`
      )
      .run(
        patch.directory?.trim() || current.directory,
        patch.canonical === undefined ? (current.canonical ?? null) : patch.canonical,
        patch.label === undefined ? (current.label ?? null) : patch.label,
        patch.snapshot === undefined
          ? current.snapshot
            ? JSON.stringify(current.snapshot)
            : null
          : patch.snapshot
            ? JSON.stringify(patch.snapshot)
            : null,
        Date.now(),
        Date.now(),
        workspaceID
      )
    return this.workspace(workspaceID)
  }

  /** Drop links owned by this workspace that the harness no longer reports. */
  removeWorkspaceLinksExcept(workspaceID: string, keepHarnessProjectIDs: string[]): number {
    if (keepHarnessProjectIDs.length === 0) {
      return this.db
        .prepare('DELETE FROM harness_project_links WHERE workspace_id = ?')
        .run(workspaceID).changes
    }
    const placeholders = keepHarnessProjectIDs.map(() => '?').join(', ')
    return this.db
      .prepare(
        `DELETE FROM harness_project_links
          WHERE workspace_id = ?
            AND harness_project_id NOT IN (${placeholders})`
      )
      .run(workspaceID, ...keepHarnessProjectIDs).changes
  }

  /**
   * Apply one resolved workspace atomically: remove stale links, attach every
   * matching harness record, and store the harness snapshot. A record already
   * owned by another Clara project is a conflict and is never reassigned, so a
   * sync cannot move sessions between projects.
   */
  reconcileWorkspaceLinks(input: ReconcileWorkspaceLinksInput): ReconcileWorkspaceLinksResult {
    const conflicts = input.harnessProjectIDs.filter((harnessProjectID) => {
      const existing = this.linkForHarnessProject(input.harnessID, harnessProjectID)
      return existing !== undefined && existing.project_id !== input.projectID
    })
    if (conflicts.length > 0) return { linked: 0, conflicts }

    const write = this.db.transaction(() => {
      this.removeWorkspaceLinksExcept(input.workspaceID, input.harnessProjectIDs)
      for (const harnessProjectID of input.harnessProjectIDs) {
        this.linkHarnessProject({
          harnessID: input.harnessID,
          harnessProjectID,
          projectID: input.projectID,
          workspaceID: input.workspaceID,
        })
      }
      this.updateWorkspace(input.workspaceID, {
        ...(input.canonical === undefined ? {} : { canonical: input.canonical }),
        ...(input.snapshot === undefined ? {} : { snapshot: input.snapshot }),
      })
    })
    write()
    return { linked: input.harnessProjectIDs.length, conflicts: [] }
  }

  /** Attach a harness record unless another Clara project already owns it. */
  claimHarnessProject(input: {
    harnessID: string
    harnessProjectID: string
    projectID: string
    workspaceID: string
    lastSeenAt?: number
  }): boolean {
    const existing = this.linkForHarnessProject(input.harnessID, input.harnessProjectID)
    if (existing) return existing.project_id === input.projectID
    this.linkHarnessProject(input)
    return true
  }

  /**
   * Low-level upsert that can reassign a harness record. Prefer
   * claimHarnessProject or reconcileWorkspaceLinks so sessions never move
   * between Clara projects by accident.
   */
  linkHarnessProject(input: {
    harnessID: string
    harnessProjectID: string
    projectID: string
    workspaceID: string
    lastSeenAt?: number
  }): void {
    this.db
      .prepare(
        `INSERT INTO harness_project_links
           (harness_id, harness_project_id, project_id, workspace_id, last_seen_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(harness_id, harness_project_id) DO UPDATE SET
           project_id = excluded.project_id,
           workspace_id = excluded.workspace_id,
           last_seen_at = excluded.last_seen_at`
      )
      .run(
        input.harnessID,
        input.harnessProjectID,
        input.projectID,
        input.workspaceID,
        input.lastSeenAt ?? Date.now()
      )
  }

  harnessProjectIds(harnessID: string, projectID: string): string[] {
    const rows = this.db
      .prepare(
        `SELECT harness_project_id
           FROM harness_project_links
          WHERE harness_id = ? AND project_id = ?
          ORDER BY harness_project_id`
      )
      .all(harnessID, projectID) as Array<{ harness_project_id: string }>
    return rows.map((row) => row.harness_project_id)
  }

  linksForProject(projectID: string): LinkRow[] {
    return this.db
      .prepare(
        `SELECT harness_id, harness_project_id, project_id, workspace_id, last_seen_at
           FROM harness_project_links
          WHERE project_id = ?
          ORDER BY harness_id, harness_project_id`
      )
      .all(projectID) as LinkRow[]
  }

  linkForHarnessProject(harnessID: string, harnessProjectID: string): LinkRow | undefined {
    return this.db
      .prepare(
        `SELECT harness_id, harness_project_id, project_id, workspace_id, last_seen_at
           FROM harness_project_links
          WHERE harness_id = ? AND harness_project_id = ?`
      )
      .get(harnessID, harnessProjectID) as LinkRow | undefined
  }

  projectForHarnessProject(harnessID: string, harnessProjectID: string): ProjectState | undefined {
    const row = this.db
      .prepare(
        `SELECT ${PROJECT_COLUMNS.split(',')
          .map((column) => `p.${column.trim()}`)
          .join(', ')}
           FROM harness_project_links l
           JOIN clara_projects p ON p.id = l.project_id
          WHERE l.harness_id = ? AND l.harness_project_id = ?`
      )
      .get(harnessID, harnessProjectID) as ProjectRow | undefined
    return row ? toProjectState(row) : undefined
  }

  workspaceForHarnessProject(
    harnessID: string,
    harnessProjectID: string
  ): WorkspaceState | undefined {
    const row = this.db
      .prepare(
        `SELECT ${WORKSPACE_COLUMNS.split(',')
          .map((column) => `w.${column.trim()}`)
          .join(', ')}
           FROM harness_project_links l
           JOIN clara_project_workspaces w ON w.id = l.workspace_id
          WHERE l.harness_id = ? AND l.harness_project_id = ?`
      )
      .get(harnessID, harnessProjectID) as WorkspaceRow | undefined
    return row ? toWorkspaceState(row) : undefined
  }

  /** Attach an unlinked harness record to an existing workspace with the same directory. */
  linkMatchingWorkspace(
    harnessID: string,
    harnessProjectID: string,
    canonical: string
  ): WorkspaceState | undefined {
    const row = this.db
      .prepare(
        `SELECT ${WORKSPACE_COLUMNS}
           FROM clara_project_workspaces
          WHERE harness_id = ? AND (canonical = ? OR directory = ?)
          ORDER BY created_at ASC
          LIMIT 1`
      )
      .get(harnessID, canonical, canonical) as WorkspaceRow | undefined
    if (!row) return undefined
    const workspace = toWorkspaceState(row)
    const claimed = this.claimHarnessProject({
      harnessID,
      harnessProjectID,
      projectID: workspace.projectID,
      workspaceID: workspace.id,
    })
    return claimed ? workspace : undefined
  }

  touchActivity(projectID: string, at: number): void {
    if (!Number.isFinite(at)) return
    this.db
      .prepare(
        `UPDATE clara_projects
            SET last_active_at = MAX(COALESCE(last_active_at, 0), ?)
          WHERE id = ?`
      )
      .run(at, projectID)
  }

  sessionWorkspaceID(harnessID: string, projectID: string): string | undefined {
    const row = this.db
      .prepare(
        `SELECT id FROM clara_project_workspaces
          WHERE project_id = ? AND harness_id = ?
          ORDER BY created_at ASC
          LIMIT 1`
      )
      .get(projectID, harnessID) as { id: string } | undefined
    return row?.id
  }

  /** Forget Clara-side archive markers so harness state becomes authoritative again. */
  clearSessionArchive(projectID: string): void {
    this.db
      .prepare('UPDATE clara_sessions SET archived_at = NULL WHERE project_id = ?')
      .run(projectID)
  }

  private recordFromRow(row: ProjectRow): ProjectRecord {
    const project = toProjectState(row)
    return { project, workspaces: this.workspaces(project.id) }
  }
}

function toProjectState(row: ProjectRow): ProjectState {
  return {
    id: row.id,
    ...(row.name ? { name: row.name } : {}),
    ...(row.icon_json ? { icon: parseObject(row.icon_json) as ClaraProject['icon'] } : {}),
    ...(row.commands_json
      ? { commands: parseObject(row.commands_json) as ClaraProject['commands'] }
      : {}),
    ...(row.startup_script ? { startupScript: row.startup_script } : {}),
    ...(row.archived_at !== null ? { archivedAt: row.archived_at } : {}),
    ...(row.last_active_at !== null ? { lastActiveAt: row.last_active_at } : {}),
    ...(row.default_workspace_id ? { defaultWorkspaceID: row.default_workspace_id } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function toWorkspaceState(row: WorkspaceRow): WorkspaceState {
  return {
    id: row.id,
    projectID: row.project_id,
    harnessID: row.harness_id,
    directory: row.directory,
    ...(row.canonical ? { canonical: row.canonical } : {}),
    ...(row.label ? { label: row.label } : {}),
    ...(row.snapshot_json
      ? { snapshot: parseObject(row.snapshot_json) as HarnessProjectSnapshot }
      : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.last_seen_at !== null ? { lastSeenAt: row.last_seen_at } : {}),
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
