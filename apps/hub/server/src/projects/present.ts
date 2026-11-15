import type {
  ClaraHarnessProject,
  ClaraProject,
  ClaraProjectAvailable,
  ClaraProjectWorkspace,
} from '@clara/api-contract'
import type { HarnessConnection } from '../harness/types.ts'
import type { ProjectRecord, ProjectStore, WorkspaceState } from './store.ts'

export type ProjectConnectionLookup = {
  get(harnessID: string): HarnessConnection | undefined
}

export function connectionLookup(connections: HarnessConnection[]): ProjectConnectionLookup {
  const byHarness = new Map(connections.map((connection) => [connection.harnessId, connection]))
  return { get: (harnessID) => byHarness.get(harnessID) }
}

export function toClaraProject(
  record: ProjectRecord,
  links: ReturnType<ProjectStore['linksForProject']>,
  connections: ProjectConnectionLookup
): ClaraProject {
  const byWorkspace = new Map<string, string[]>()
  for (const link of links) {
    if (!link.workspace_id) continue
    const current = byWorkspace.get(link.workspace_id) ?? []
    current.push(link.harness_project_id)
    byWorkspace.set(link.workspace_id, current)
  }
  const workspaces = record.workspaces.map((workspace) =>
    toWorkspace(workspace, byWorkspace.get(workspace.id) ?? [], connections)
  )
  const discoveredIcon = record.workspaces
    .map((workspace) => workspace.snapshot?.icon)
    .find((icon) => icon?.url)
  const icon =
    discoveredIcon || record.project.icon
      ? { ...discoveredIcon, ...record.project.icon }
      : undefined
  return {
    id: record.project.id,
    ...(record.project.name ? { name: record.project.name } : {}),
    ...(icon ? { icon } : {}),
    ...(record.project.commands ? { commands: record.project.commands } : {}),
    ...(record.project.startupScript ? { startupScript: record.project.startupScript } : {}),
    time: {
      created: record.project.createdAt,
      updated: record.project.updatedAt,
      active: record.project.lastActiveAt ?? record.project.updatedAt,
      ...(record.project.archivedAt ? { archived: record.project.archivedAt } : {}),
    },
    ...(record.project.defaultWorkspaceID
      ? { defaultWorkspaceID: record.project.defaultWorkspaceID }
      : {}),
    workspaces,
  }
}

function toWorkspace(
  workspace: WorkspaceState,
  projectIDs: string[],
  lookup: ProjectConnectionLookup
): ClaraProjectWorkspace {
  const connection = lookup.get(workspace.harnessID)
  return {
    id: workspace.id,
    harnessID: workspace.harnessID,
    harnessKind: connection?.kind ?? '',
    harnessLabel: connection?.label ?? workspace.harnessID,
    online: connection?.online ?? false,
    directory: workspace.directory,
    ...(workspace.canonical ? { canonical: workspace.canonical } : {}),
    ...(workspace.label ? { label: workspace.label } : {}),
    projectIDs,
    linked: projectIDs.length > 0,
    ...(workspace.lastSeenAt !== undefined ? { lastSeenAt: workspace.lastSeenAt } : {}),
    ...(workspace.snapshot?.vcs ? { vcs: workspace.snapshot.vcs } : {}),
    ...(workspace.snapshot?.sandboxes ? { sandboxes: workspace.snapshot.sandboxes } : {}),
  }
}

export function toAvailableProject(
  connection: Pick<HarnessConnection, 'kind' | 'label' | 'harnessId'>,
  project: Pick<ClaraHarnessProject, 'id' | 'canonical' | 'name' | 'vcs'>
): ClaraProjectAvailable {
  return {
    harnessID: connection.harnessId,
    harnessLabel: connection.label,
    harnessKind: connection.kind,
    projectID: project.id,
    canonical: project.canonical,
    ...(project.name ? { name: project.name } : {}),
    ...(project.vcs ? { vcs: project.vcs } : {}),
  }
}
