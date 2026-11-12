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
 * hide real work.
 */
export function filterVisibleProjects(
  projects: ClaraProject[],
  hasSessions: ReadonlyMap<string, boolean>,
  showEmpty: boolean
): ClaraProject[] {
  if (showEmpty) return projects
  return projects.filter((project) => hasSessions.get(project.id) !== false)
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
