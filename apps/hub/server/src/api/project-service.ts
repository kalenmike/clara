import type { ClaraHarnessProject, ClaraProjectHarnessResult } from '@clara/api-contract'
import type { HarnessConnection } from '../harness/types.ts'
import type { WorkspaceState } from '../projects/store.ts'
import { ApiRequestError, type ApiDependencies } from './context.ts'
import { forwardDtoTo, parseClaraLocation, parseHarnessProjects } from './dto.ts'
import { forwardResultTo, query } from './harness.ts'

type Action = 'archive' | 'unarchive' | 'delete'

function supports(connection: HarnessConnection, action: Action): boolean {
  const projects = connection.capabilities.projects
  if (!projects || typeof projects !== 'object' || Array.isArray(projects)) return false
  return (projects as Record<string, unknown>)[action] === true
}

async function listHarnessProjects(
  deps: ApiDependencies,
  harnessID: string,
  signal: AbortSignal
): Promise<ClaraHarnessProject[]> {
  const [active, archived] = await Promise.all([
    forwardDtoTo(
      deps,
      harnessID,
      { method: 'GET', path: '/projects', search: query({ archived: false }) },
      signal,
      parseHarnessProjects
    ).catch(() => []),
    forwardDtoTo(
      deps,
      harnessID,
      { method: 'GET', path: '/projects', search: query({ archived: true }) },
      signal,
      parseHarnessProjects
    ).catch(() => []),
  ])
  const byID = new Map<string, ClaraHarnessProject>()
  for (const project of [...active, ...archived]) byID.set(project.id, project)
  return [...byID.values()]
}

/**
 * Resolve one workspace through its harness. The harness is the authority for
 * the canonical path and for every project record that belongs to it; Clara
 * only stores the resulting links.
 */
export async function syncWorkspace(
  deps: ApiDependencies,
  workspace: WorkspaceState,
  signal: AbortSignal
): Promise<{ linked: number; code?: string; message?: string }> {
  const connection = deps.harness.connection(workspace.harnessID)
  if (!connection) {
    return { linked: 0, code: 'harness_missing', message: 'This harness is no longer paired' }
  }
  if (!connection.online) {
    return { linked: 0, code: 'offline', message: 'The harness adapter is offline' }
  }

  let location
  try {
    location = await forwardDtoTo(
      deps,
      workspace.harnessID,
      {
        method: 'GET',
        path: '/locations',
        search: query({ location: { directory: workspace.directory } }),
      },
      signal,
      parseClaraLocation
    )
  } catch (cause) {
    if (cause instanceof ApiRequestError) {
      return { linked: 0, code: cause.code, message: cause.message }
    }
    return { linked: 0, code: 'upstream_error', message: errorMessage(cause) }
  }

  const canonical = location.project.canonical || location.directory
  const projects = await listHarnessProjects(deps, workspace.harnessID, signal)
  const matches = new Map<string, (typeof projects)[number]>()
  for (const project of projects) {
    if (project.canonical === canonical || project.id === location.project.id) {
      matches.set(project.id, project)
    }
  }
  if (matches.size === 0) {
    matches.set(location.project.id, {
      id: location.project.id,
      canonical,
      time: { created: Date.now(), updated: Date.now(), active: Date.now() },
      sandboxes: [],
    })
  }

  const snapshotProject = matches.get(location.project.id) ?? [...matches.values()][0]
  const store = deps.harness.projects
  for (const project of matches.values()) {
    store.linkHarnessProject({
      harnessID: workspace.harnessID,
      harnessProjectID: project.id,
      projectID: workspace.projectID,
      workspaceID: workspace.id,
    })
  }
  store.updateWorkspace(workspace.id, {
    canonical,
    ...(snapshotProject
      ? {
          snapshot: {
            id: snapshotProject.id,
            canonical: snapshotProject.canonical,
            ...(snapshotProject.vcs ? { vcs: snapshotProject.vcs } : {}),
            ...(snapshotProject.icon ? { icon: snapshotProject.icon } : {}),
            ...(snapshotProject.sandboxes ? { sandboxes: snapshotProject.sandboxes } : {}),
          },
        }
      : {}),
  })
  return { linked: matches.size }
}

export async function syncProject(
  deps: ApiDependencies,
  projectID: string,
  signal: AbortSignal
): Promise<void> {
  const record = deps.harness.projects.get(projectID)
  if (!record) throw new ApiRequestError(404, 'not_found', 'That project no longer exists')
  await Promise.all(record.workspaces.map((workspace) => syncWorkspace(deps, workspace, signal)))
}

function projectLinkGroups(deps: ApiDependencies, projectID: string): Map<string, string[]> {
  const groups = new Map<string, string[]>()
  for (const link of deps.harness.projects.linksForProject(projectID)) {
    const current = groups.get(link.harness_id) ?? []
    current.push(link.harness_project_id)
    groups.set(link.harness_id, current)
  }
  return groups
}

async function signalHarness(
  deps: ApiDependencies,
  connection: HarnessConnection,
  projectIDs: string[],
  action: Action,
  signal: AbortSignal
): Promise<ClaraProjectHarnessResult> {
  const capability = action === 'unarchive' ? 'archive' : action
  if (!supports(connection, capability)) {
    return {
      harnessID: connection.harnessId,
      label: connection.label,
      kind: connection.kind,
      ok: false,
      code: 'unsupported',
      message: `${connection.label} does not support project ${action}`,
    }
  }
  if (!connection.online) {
    return {
      harnessID: connection.harnessId,
      label: connection.label,
      kind: connection.kind,
      ok: false,
      code: 'offline',
      message: `${connection.label} is offline`,
    }
  }

  let affected = 0
  try {
    for (const projectID of projectIDs) {
      const result = await forwardResultTo<{ affected?: unknown } | undefined>(
        deps,
        connection.harnessId,
        {
          method: action === 'delete' ? 'DELETE' : 'POST',
          path:
            action === 'delete'
              ? `/projects/${encodeURIComponent(projectID)}`
              : `/projects/${encodeURIComponent(projectID)}/${action}`,
        },
        signal
      )
      if (typeof result?.affected === 'number') affected += result.affected
    }
    return {
      harnessID: connection.harnessId,
      label: connection.label,
      kind: connection.kind,
      ok: true,
      affected,
    }
  } catch (cause) {
    if (cause instanceof ApiRequestError) {
      return {
        harnessID: connection.harnessId,
        label: connection.label,
        kind: connection.kind,
        ok: false,
        code: cause.code,
        message: cause.message,
      }
    }
    return {
      harnessID: connection.harnessId,
      label: connection.label,
      kind: connection.kind,
      ok: false,
      code: 'upstream_error',
      message: errorMessage(cause),
    }
  }
}

/**
 * Ask every linked harness to archive or unarchive its project data. Clara's
 * own state is applied by the route so a missing harness never blocks the user.
 */
export async function signalProjectArchive(
  deps: ApiDependencies,
  projectID: string,
  archived: boolean,
  signal: AbortSignal
): Promise<ClaraProjectHarnessResult[]> {
  const groups = projectLinkGroups(deps, projectID)
  const results: ClaraProjectHarnessResult[] = []
  for (const [harnessID, projectIDs] of groups) {
    const connection = deps.harness.connection(harnessID)
    if (!connection) {
      results.push({
        harnessID,
        label: harnessID,
        kind: '',
        ok: false,
        code: 'harness_missing',
        message: 'This harness is no longer paired',
      })
      continue
    }
    results.push(
      await signalHarness(deps, connection, projectIDs, archived ? 'archive' : 'unarchive', signal)
    )
  }
  return results
}

export async function signalProjectDelete(
  deps: ApiDependencies,
  projectID: string,
  signal: AbortSignal
): Promise<ClaraProjectHarnessResult[]> {
  const groups = projectLinkGroups(deps, projectID)
  const results: ClaraProjectHarnessResult[] = []
  for (const [harnessID, projectIDs] of groups) {
    const connection = deps.harness.connection(harnessID)
    if (!connection) {
      results.push({
        harnessID,
        label: harnessID,
        kind: '',
        ok: false,
        code: 'harness_missing',
        message: 'This harness is no longer paired',
      })
      continue
    }
    results.push(await signalHarness(deps, connection, projectIDs, 'delete', signal))
  }
  return results
}

/** Harness projects that are not attached to any Clara workspace yet. */
export async function availableProjects(
  deps: ApiDependencies,
  harnessID: string,
  signal: AbortSignal
) {
  const connection = deps.harness.connection(harnessID)
  if (!connection) {
    throw new ApiRequestError(404, 'not_found', 'That harness is no longer paired')
  }
  if (!connection.online) {
    throw new ApiRequestError(503, 'harness_offline', 'That harness adapter is offline')
  }
  const projects = await listHarnessProjects(deps, harnessID, signal)
  const store = deps.harness.projects
  return projects
    .filter((project) => {
      if (store.linkForHarnessProject(harnessID, project.id)) return false
      return !store.findWorkspaceByCanonical(harnessID, project.canonical)
    })
    .map((project) => ({ connection, project }))
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
