import type { ApiDependencies } from './context.ts'
import { ApiRequestError } from './context.ts'
import { syncProject } from './project-service.ts'

export type HarnessProjectGroup = {
  harnessID: string
  projectIDs: string[]
}

/** Require an explicitly requested harness to still be paired. */
export function requireHarness(deps: ApiDependencies, harnessID: string): string {
  if (!deps.harness.connection(harnessID)) {
    throw new ApiRequestError(404, 'harness_missing', 'That harness is no longer paired')
  }
  return harnessID
}

/**
 * Context-free routes must name a harness. There is no hub-wide default.
 */
export function requireHarnessContext(deps: ApiDependencies, harnessID?: string): string {
  if (!deps.canAccess()) {
    throw new ApiRequestError(403, 'disabled', 'Harness access is disabled by an admin setting')
  }
  if (!deps.harness.configured) {
    throw new ApiRequestError(
      503,
      'harness_unconfigured',
      'No harness adapter is configured. Add one in the hub panel.'
    )
  }
  if (!harnessID) {
    throw new ApiRequestError(
      409,
      'harness_required',
      'Name a paired harness for this request. Clara does not choose one for you.',
      { harnessIDs: deps.harness.list().map((connection) => connection.harnessId) }
    )
  }
  return requireHarness(deps, harnessID)
}

/**
 * Resolve the harness that owns a session. Every session read by the hub is
 * recorded in `clara_sessions`; a client that opened a session before the hub
 * listed it must send the owning harness explicitly.
 */
export function resolveHarnessForSession(
  deps: ApiDependencies,
  sessionID: string,
  explicitHarnessID?: string
): string {
  if (explicitHarnessID) return requireHarness(deps, explicitHarnessID)
  const owner = deps.harness.metadata.harnessIdForSession(sessionID)
  if (owner) return owner
  throw new ApiRequestError(409, 'harness_required', 'Name the harness that owns this session.', {
    sessionID,
    harnessIDs: deps.harness.list().map((connection) => connection.harnessId),
  })
}

/**
 * Resolve a directory-scoped request. An explicit harness wins, otherwise the
 * directory must match exactly one workspace. Ambiguity is an error instead of
 * a guess: the same path can exist on two machines.
 */
export function resolveHarnessForDirectory(
  deps: ApiDependencies,
  directory: string | undefined,
  explicitHarnessID?: string
): string {
  if (explicitHarnessID) return requireHarness(deps, explicitHarnessID)
  if (!directory) {
    throw new ApiRequestError(
      409,
      'harness_required',
      'Name a paired harness for this request. Clara does not choose one for you.',
      { harnessIDs: deps.harness.list().map((connection) => connection.harnessId) }
    )
  }

  const harnessIDs = [
    ...new Set(
      deps.harness.projects
        .workspacesForDirectory(directory)
        .map((workspace) => workspace.harnessID)
    ),
  ]
  if (harnessIDs.length === 1) return requireHarness(deps, harnessIDs[0])

  if (harnessIDs.length > 1) {
    throw new ApiRequestError(
      409,
      'harness_ambiguous',
      'That directory exists on more than one harness. Choose a harness.',
      { harnessIDs }
    )
  }
  throw new ApiRequestError(
    409,
    'harness_required',
    'That directory is not linked to a paired harness. Choose a harness.',
    { harnessIDs: deps.harness.list().map((connection) => connection.harnessId) }
  )
}

/**
 * Every harness project record linked to a Clara project, grouped by harness.
 * If nothing is linked yet, resolve the project's workspaces once and retry so
 * a newly paired harness does not look empty.
 */
export async function resolveHarnessProjectGroups(
  deps: ApiDependencies,
  projectID: string,
  signal: AbortSignal
): Promise<HarnessProjectGroup[]> {
  const direct = projectGroups(deps, projectID)
  if (direct.length > 0) return direct
  if (!deps.harness.projects.get(projectID)) return []
  await syncProject(deps, projectID, signal).catch(() => undefined)
  return projectGroups(deps, projectID)
}

function projectGroups(deps: ApiDependencies, projectID: string): HarnessProjectGroup[] {
  const groups = new Map<string, string[]>()
  for (const link of deps.harness.projects.linksForProject(projectID)) {
    const current = groups.get(link.harness_id) ?? []
    if (!current.includes(link.harness_project_id)) current.push(link.harness_project_id)
    groups.set(link.harness_id, current)
  }
  return [...groups].map(([harnessID, projectIDs]) => ({ harnessID, projectIDs }))
}

/** A stable key for the hub-owned multi-record session cursor. */
export function sessionPageKey(harnessID: string, projectID: string): string {
  return `${harnessID}:${projectID}`
}
