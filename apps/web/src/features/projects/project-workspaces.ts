import type { ClaraProject, ClaraProjectWorkspace } from '@clara/api-contract'

/**
 * Workspaces on a project that can hold sessions, across every harness. Offline
 * workspaces stay in the list so the picker can show them disabled instead of
 * silently dropping a location.
 */
export function projectSessionWorkspaces(
  project: ClaraProject | null | undefined
): ClaraProjectWorkspace[] {
  if (!project) return []
  return project.workspaces.filter((workspace) => workspace.linked)
}

/** A session can only start where the harness has linked and is reachable. */
export function isWorkspaceStartable(workspace: ClaraProjectWorkspace): boolean {
  return workspace.linked && workspace.online
}

export type ProjectWorkspaceTarget = {
  /** The workspace to show, even when it is offline so the choice stays visible. */
  workspace: ClaraProjectWorkspace | null
  /** Whether work can start in the target workspace right now. */
  startable: boolean
}

/**
 * Pick the workspace a project's next action should use:
 *
 * 1. the workspace last used for this project,
 * 2. the project's default workspace when it is online,
 * 3. the first online workspace,
 * 4. the first linked workspace, even when offline.
 *
 * Passing `harnessID` restricts the search to one harness so moving an existing
 * session can never land in a workspace that belongs to a different harness.
 */
export function resolveProjectWorkspaceTarget(
  project: ClaraProject | null | undefined,
  lastUsedWorkspaceID?: string | null,
  options: { harnessID?: string | null } = {}
): ProjectWorkspaceTarget {
  const linked = projectSessionWorkspaces(project)
  const workspaces = options.harnessID
    ? linked.filter((workspace) => workspace.harnessID === options.harnessID)
    : linked

  if (workspaces.length === 0) return { workspace: null, startable: false }

  const lastUsed = lastUsedWorkspaceID
    ? workspaces.find((workspace) => workspace.id === lastUsedWorkspaceID)
    : undefined
  const defaultWorkspace = project?.defaultWorkspaceID
    ? workspaces.find(
        (workspace) => workspace.id === project.defaultWorkspaceID && workspace.online
      )
    : undefined
  const firstOnline = workspaces.find((workspace) => workspace.online)
  const workspace = lastUsed ?? defaultWorkspace ?? firstOnline ?? workspaces[0] ?? null

  return {
    workspace,
    startable: workspace ? isWorkspaceStartable(workspace) : false,
  }
}

/** Whether a project's workspaces live on more than one paired harness. */
export function projectSpansHarnesses(project: ClaraProject | null | undefined): boolean {
  if (!project) return false
  return new Set(project.workspaces.map((workspace) => workspace.harnessID)).size > 1
}

function shortHarnessID(harnessID: string): string {
  const trimmed = harnessID.trim()
  return trimmed.length > 6 ? trimmed.slice(-6) : trimmed
}

/**
 * Harness labels keyed by workspace id. Workspaces that share a label across
 * different harnesses get a short harness id appended so the picker can tell
 * them apart.
 */
export function workspaceHarnessLabels(
  workspaces: readonly ClaraProjectWorkspace[]
): Map<string, string> {
  const harnessesByLabel = new Map<string, Set<string>>()
  for (const workspace of workspaces) {
    const label = workspace.harnessLabel.trim() || workspace.harnessID
    const harnesses = harnessesByLabel.get(label) ?? new Set<string>()
    harnesses.add(workspace.harnessID)
    harnessesByLabel.set(label, harnesses)
  }

  const labels = new Map<string, string>()
  for (const workspace of workspaces) {
    const label = workspace.harnessLabel.trim() || workspace.harnessID
    const duplicate = (harnessesByLabel.get(label)?.size ?? 0) > 1
    labels.set(
      workspace.id,
      duplicate ? `${label} (${shortHarnessID(workspace.harnessID)})` : label
    )
  }
  return labels
}
