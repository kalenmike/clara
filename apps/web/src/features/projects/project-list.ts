import type { ClaraProject } from '@clara/api-contract'

export const RECENT_PROJECT_LIMIT = 7

function workspaceLabel(project: ClaraProject): string | undefined {
  const workspace =
    project.workspaces.find((item) => item.id === project.defaultWorkspaceID) ??
    project.workspaces[0]
  const directory = workspace?.canonical ?? workspace?.directory
  return directory?.split('/').filter(Boolean).pop()
}

/** The name shown for a project, falling back to its default workspace folder. */
export function projectLabel(project: ClaraProject): string {
  const name = project.name?.trim()
  if (name) return name
  return workspaceLabel(project) ?? 'Untitled project'
}

/**
 * The workspace line under a project in the sidebar switcher. A single
 * workspace names its directory; several collapse into a count so one path
 * never reads as the project's only location.
 */
export function projectSwitcherWorkspaceLabel(project: ClaraProject): string {
  const count = project.workspaces.length
  if (count === 0) return 'No workspaces'
  if (count > 1) return `${count} workspaces`
  return project.workspaces[0]?.directory ?? '1 workspace'
}

/** Short workspace summary for cards and the selector. */
export function projectWorkspaceSummary(project: ClaraProject): string {
  const count = project.workspaces.length
  if (count === 0) return 'No workspaces'
  if (count === 1) {
    const workspace = project.workspaces[0]
    return workspace ? `${workspace.harnessLabel} · ${workspace.directory}` : '1 workspace'
  }
  const harnesses = new Set(project.workspaces.map((workspace) => workspace.harnessLabel))
  return `${count} workspaces · ${harnesses.size} ${harnesses.size === 1 ? 'harness' : 'harnesses'}`
}

/** The server's last-activity timestamp, with stable fallbacks for older records. */
export function projectRecency(project: ClaraProject): number {
  return project.time.active || project.time.updated || project.time.created
}

function compareProjects(a: ClaraProject, b: ClaraProject): number {
  return (
    projectRecency(b) - projectRecency(a) ||
    b.time.updated - a.time.updated ||
    b.time.created - a.time.created ||
    projectLabel(a).localeCompare(projectLabel(b))
  )
}

/** Newest activity first. */
export function sortProjectsByRecency(projects: ClaraProject[]): ClaraProject[] {
  return [...projects].sort(compareProjects)
}

/**
 * Hide projects without sessions unless the person asked to show them. Projects
 * whose session lookup is still unknown stay visible so a failed lookup cannot
 * hide real work, and projects with an offline or failed harness stay visible
 * because their sessions may simply not have been counted.
 */
export function filterVisibleProjects(
  projects: ClaraProject[],
  hasSessions: ReadonlyMap<string, boolean>,
  showEmpty: boolean,
  incomplete: ReadonlySet<string> = new Set()
): ClaraProject[] {
  if (showEmpty) return projects
  return projects.filter(
    (project) => incomplete.has(project.id) || hasSessions.get(project.id) !== false
  )
}

/**
 * The projects shown in the sidebar switcher. The selected project is pinned
 * into the list when it falls outside the recent window.
 */
export function recentProjects(
  projects: ClaraProject[],
  selectedID?: string | null,
  limit = RECENT_PROJECT_LIMIT
): ClaraProject[] {
  if (limit <= 0) return []
  const sorted = sortProjectsByRecency(projects)
  const recent = sorted.slice(0, limit)
  if (!selectedID || recent.some((project) => project.id === selectedID)) return recent

  const selected = sorted.find((project) => project.id === selectedID)
  if (!selected) return recent
  return [...sorted.slice(0, limit - 1), selected]
}
